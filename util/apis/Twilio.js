import twilio from "twilio";
import prisma from "../prismaClient.js";
import { normalizePhoneNumber, toE164 } from "../DataUtilities.js";
import fetch from "node-fetch";
import events from "../events.js";
import {
  resolveUserByPhoneNumber,
  sendMessageBlocks,
  uploadFile,
} from "./SlackBot.js";
import * as Sentry from "@sentry/node";
import * as PostHog from "./PostHog.js";
import { extension } from "mime-types";

/**
 * Twilio sends webhook params as form-encoded key/value pairs.
 * This typedef captures the subset referenced in this module.
 * @typedef {Object} TwilioWebhookBody
 * @property {string | undefined} From
 * @property {string | undefined} To
 * @property {string | undefined} Body
 * @property {string | undefined} Digits
 * @property {string | undefined} CallSid
 * @property {string | undefined} ParentCallSid
 * @property {string | undefined} DialCallStatus
 * @property {string | undefined} DialCallDuration
 * @property {string | undefined} RecordingUrl
 * @property {string | undefined} RecordingSid
 * @property {string | undefined} RecordingDuration
 * @property {string | undefined} NumMedia
 * @property {string | undefined} MediaUrl0
 * @property {string | undefined} MediaUrl1
 * @property {string | undefined} MediaUrl2
 * @property {string | undefined} MediaUrl3
 * @property {string | undefined} MediaUrl4
 * @property {string | undefined} MediaUrl5
 * @property {string | undefined} MediaUrl6
 * @property {string | undefined} MediaUrl7
 * @property {string | undefined} MediaUrl8
 * @property {string | undefined} MediaUrl9
 */

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

/**
 * Clears the assigned employee fields for a Twilio number record.
 * @param {string} phoneNumber - TwilioNumber id to unassign (E.164).
 * @returns {Promise<void>}
 */
export async function unassignNumber(phoneNumber) {
  console.log("Twilio: Unassigning number " + phoneNumber);

  await prisma.twilioNumber.update({
    where: {
      id: phoneNumber,
    },
    data: {
      assignedEmployee: null,
      assignedEmployeeNumber: null,
      assignedEmployeeName: null,
    },
  });
}

/**
 * Backfills missing Slack user assignments for unassigned numbers, then returns all numbers.
 * @returns {Promise<Array<import("@prisma/client").TwilioNumber>>}
 */
export async function returnAssignedPhoneNumbers() {
  // Check in DB for any unassigned numbers
  const unassignedNumbers = await prisma.twilioNumber.findMany({
    where: {
      assignedEmployee: null,
    },
  });

  // If any unassigned numbers, look up the user they're for
  for (const unassignedNumber of unassignedNumbers) {
    // Look up which employee
    console.log(
      `Twilio: Updating the employee for number ${unassignedNumber.phoneNumber}`,
    );
    const slackUser = await resolveUserByPhoneNumber(
      unassignedNumber.assignedEmployeeNumber,
    );

    if (slackUser) {
      console.log(
        `Twilio: Found Slack user ${slackUser.id} for phone number ${unassignedNumber.phoneNumber}`,
      );

      await prisma.twilioNumber.update({
        where: {
          id: unassignedNumber.id,
        },
        data: {
          assignedEmployee: slackUser.id,
        },
      });
    } else {
      console.log(
        `Twilio: Couldn't find a Slack user for ${unassignedNumber.phoneNumber}`,
      );
    }
  }

  // Fetch all numbers in DB
  return prisma.twilioNumber.findMany();
}

/**
 * Looks up the employee by phone number in Slack, then updates TwilioNumber records.
 * @param {string} employeePhoneNumber - The employee phone number (E.164) to resolve in Slack.
 * @returns {Promise<boolean>} True if at least one TwilioNumber record was updated.
 */
async function updateTwilioNumberSlackDetails(employeePhoneNumber) {
  const member = await resolveUserByPhoneNumber(employeePhoneNumber);

  if (!member) {
    return false;
  }

  let name = member.profile.first_name;
  if (!name || name === "") {
    name = member.profile.display_name;
  }
  if (!name || name === "") {
    name = member.profile.real_name;
  }

  if (!name || name === "") {
    const errorMessage = `Twilio: Slack user doesn't have a profile.first_name, profile.display_name, or profile.real_name field! Slack user JSON:\n${JSON.stringify(member)}`;
    console.error(errorMessage);
    Sentry.captureException(errorMessage, member);
  }

  const result = await prisma.twilioNumber.updateMany({
    where: {
      assignedEmployeeNumber: employeePhoneNumber,
    },
    data: {
      assignedEmployee: member.id,
      assignedEmployeeName: name,
    },
  });

  return result.count > 0;
}

/**
 * Assigns a Twilio number to an employee on first use.
 *
 * Flow:
 * 1) If an employee already has a TwilioNumber (assignedEmployeeNumber = E.164), return it.
 * 2) Else find the first unassigned TwilioNumber.
 * 3) Assign it to the employee.
 * 4) Return it.
 *
 * Concurrency: uses a transaction and conditional update to avoid double-assignments.
 * @param {string} employeePhoneNumber - The employee phone number (any format).
 * @returns {Promise<{phoneNumber: string}>} Assigned Twilio number.
 * @throws {Error} When no Twilio numbers are available to assign.
 */
export async function getOrAssignEmployeeNumber(employeePhoneNumber) {
  const employeeE164 = toE164(employeePhoneNumber);

  const result = await prisma.$transaction(
    async (tx) => {
      // Step 1: already assigned?
      const existing = await tx.twilioNumber.findFirst({
        where: { assignedEmployeeNumber: employeeE164 },
        select: { phoneNumber: true },
      });

      if (existing?.phoneNumber) return existing;

      // Step 2: get first unassigned
      const candidate = await tx.twilioNumber.findFirst({
        where: {
          assignedEmployeeNumber: null,
        },
        orderBy: {
          phoneNumber: "asc",
        },
        select: {
          id: true,
          phoneNumber: true,
        },
      });

      if (!candidate) return null;

      // Step 3: attempt to assign (conditional update prevents double-claim)
      const updated = await tx.twilioNumber.updateMany({
        where: {
          id: candidate.id,
          assignedEmployeeNumber: null,
        },
        data: {
          assignedEmployeeNumber: employeeE164,
        },
      });

      if (updated.count === 1) {
        // Look up the Slack profile of the employee and async update it in the DB
        updateTwilioNumberSlackDetails(employeeE164).then(() => {
          console.log(
            `Twilio: Assigned ${employeeE164} to ${candidate.phoneNumber}`,
          );
        });

        // Step 4: return the newly assigned number
        return { phoneNumber: candidate.phoneNumber };
      }
    },
    {
      // Postgres: helps reduce weird edge cases under concurrency
      isolationLevel: "Serializable",
    },
  );

  if (!result) {
    const errorMessage =
      "Twilio: Failed to assign Twilio number, no numbers available.";
    console.error(errorMessage);
    Sentry.captureException(new Error(errorMessage));

    let message = `Error from the call bot. *Super technical error code*: :robot_face::frowning::thumbsdown:\nI can't assign a phone number to a user. Check my page for current phone number assignments, and maybe add phone numbers in Twilio?`;
    events.emit(
      "slackbot-send-message",
      message,
      "Call Bot Twilio Number Error",
    );

    throw new Error(
      "No available Twilio numbers to assign. Please add more numbers to the TwilioNumber table.",
    );
  }

  return result;
}

/**
 * Updates last contact time and thread id for a TwilioContact using call data.
 * @param {{from: string}} call - Call-like object containing a `from` number.
 * @param {string | null} threadTs - Slack thread timestamp.
 * @returns {Promise<void>}
 */
export async function updateTwilioContactTs(call, threadTs) {
  if (!call?.from) {
    console.warn(
      "Twilio: updateTwilioContactTs called with no call.from, skipping",
    );
    return;
  }

  const now = new Date();

  const ops = [
    prisma.twilioContact.update({
      where: {
        id: call.from,
      },
      data: {
        lastContactAt: now,
        slackThreadId: threadTs,
      },
    }),
  ];

  await prisma.$transaction(ops);
}

/**
 * Upserts a TwilioContact for the customer and updates last-contact metadata.
 * @param {string} customerNumber - Customer phone number (any format).
 * @param {string} twilioNumber - Twilio number used for the interaction (any format).
 * @param {string | null} [slackThreadId=null] - Slack thread id to associate.
 * @returns {Promise<void>}
 */
export async function updateTwilioContact(
  customerNumber,
  twilioNumber,
  slackThreadId = null,
) {
  const cleanedCustomerNumber = toE164(customerNumber);
  const cleanedTwilioNumber = toE164(twilioNumber);

  const now = new Date();

  const ops = [
    prisma.twilioContact.upsert({
      where: { id: cleanedCustomerNumber },
      update: {
        lastContactAt: now,
        ...(slackThreadId ? { slackThreadId } : {}),
      },
      create: {
        id: cleanedCustomerNumber,
        clientNumber: cleanedCustomerNumber,
        slackThreadId: slackThreadId,
        createdAt: now,
        lastContactAt: now,
        twilioNumberId: cleanedTwilioNumber,
      },
    }),
  ];

  await prisma.$transaction(ops);
}

/**
 * Downloads a Twilio recording as a Buffer.
 * @param {string} recordingUrlBase - Recording URL without file extension.
 * @returns {Promise<Buffer>}
 */
async function downloadTwilioRecording(recordingUrlBase) {
  const url = `${recordingUrlBase}.mp3`; // or ".wav"
  const auth = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`,
  ).toString("base64");

  const resp = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Twilio download failed (${resp.status}): ${text}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Sends a Slack message for a missed call and returns the Slack message.
 * @param {string | undefined} from - Caller number.
 * @param {string | undefined} to - Twilio number that was called.
 * @param {string | undefined} reason - Optional reason to display.
 * @returns {Promise<{ts?: string} | null>}
 */
async function sendMissedCallBlocks(from, to, reason) {
  const safeFrom = from || "<unknown>";
  const displayFrom = normalizePhoneNumber(safeFrom) || safeFrom;

  const twilioNumber = to
    ? await prisma.twilioNumber.findUnique({ where: { id: to } })
    : null;

  let heading = "Missed call ";
  if (twilioNumber.assignedEmployee) {
    heading += `for <@${twilioNumber.assignedEmployee}> `;
  }
  heading += `from ${displayFrom}`;

  const reasonText = reason ? `\n_${reason}_` : "";

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${heading}${reasonText}`,
      },
    },
  ];

  const twilioContact = from
    ? await prisma.twilioContact.findUnique({ where: { id: from } })
    : null;

  const threadId = twilioContact?.slackThreadId || null;

  if (!threadId) {
    blocks.push(
      {
        type: "divider",
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Call",
            },
            style: "primary",
            value: from,
            action_id: "outbound-call-0",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Text",
            },
            value: from,
            action_id: "outbound-text-0",
          },
        ],
      },
    );
  }

  if (from) {
    PostHog.logMissedCall({
      from,
      to,
      reason: reason || "unknown",
    }).catch((e) => {
      Sentry.captureException(e);
      console.error("Twilio: PostHog logMissedCall error:", e);
    });
  }

  const slackMessage = await sendMessageBlocks(
    `${heading}${reasonText}`,
    blocks,
    "New Call Bot",
    threadId,
    process.env.SLACK_CHANNEL,
  );

  if (from && to) {
    await updateTwilioContact(from, to, slackMessage?.ts || null);
  }

  return slackMessage;
}

/**
 * Handles Twilio inbound voice webhooks and returns TwiML response.
 * @param {import("express").Request & {body?: TwilioWebhookBody}} req
 * @param {import("express").Response} _res
 * @returns {Promise<string>}
 */
export async function handleInboundCall(req, _res) {
  const twiml = new twilio.twiml.VoiceResponse();

  try {
    const from = req.body?.From; // customer/caller
    const to = req.body?.To; // the Twilio number they dialed

    const fallbackNumber = process.env.TWILIO_FALLBACK_NUMBER;

    if (!to) {
      twiml.say("We are unable to route your call at this time.");
      twiml.dial({}, fallbackNumber);

      const errorMessage = "Twilio: Missing the number they dialed";
      console.error(errorMessage);
      Sentry.captureException(new Error(errorMessage));

      return twiml.toString();
    }

    const twilioNumber = await prisma.twilioNumber.findUnique({
      where: { id: to },
    });

    // Reject calls from our employee to their own number
    if (twilioNumber.assignedEmployeeNumber === from) {
      console.log(
        `Twilio: ${twilioNumber.assignedEmployeeName} called their own number "${twilioNumber.id}". Rejecting call.`,
      );

      // DM the user on Slack that they can't call themselves
      events.emit(
        "slack-direct-message",
        twilioNumber.assignedEmployee,
        "I see that you tried calling your own number. That won't work.\nHere's what you can do instead:\n- Click or tap on a call button in #calls\n- Send a message in a DM or channel `/dial [phone number]` (I'll then call you)\nIf you missed a call, you should see a notification in threads",
      );

      twiml.reject();

      return twiml.toString();
    }

    const employeeNumber =
      twilioNumber?.assignedEmployeeNumber ||
      twilioNumber?.assignedEmployee ||
      null;

    const dialTarget = employeeNumber || fallbackNumber;

    // Optional: tiny bit of logging context (avoid logging sensitive data in production)
    console.info(
      `Twilio Voice: inbound call to=${to} from=${from || "<unknown>"} routingTo=${dialTarget}`,
    );

    PostHog.logInboundCall({
      from,
      to,
      routedTo: dialTarget,
      assignedEmployee: twilioNumber?.assignedEmployee || null,
      assignedEmployeeName: twilioNumber?.assignedEmployeeName || null,
    }).catch((e) => {
      Sentry.captureException(e);
      console.error("Twilio: PostHog logInboundCall error:", e);
    });

    if (dialTarget === fallbackNumber) {
      const dial = twiml.dial({
        callerId: from,
        answerOnBridge: true,
        action: `${process.env.WEB_URL}/twilio/voice/after-dial`,
        method: "POST",
      });

      dial.number(dialTarget);

      return twiml.toString();
    } else {
      const dial = twiml.dial({
        callerId: from,
        answerOnBridge: true,
        action: `${process.env.WEB_URL}/twilio/voice/after-dial`,
        method: "POST",
      });

      dial.number(
        {
          url: `${process.env.WEB_URL}/twilio/voice/screen`,
          method: "POST",
        },
        dialTarget,
      );

      await updateTwilioContact(from, to, null);

      return twiml.toString();
    }
  } catch (e) {
    console.error("Twilio Voice: error handling inbound call", e);
    Sentry.captureException(e);

    twiml.dial({}, process.env.TWILIO_FALLBACK_NUMBER);
    return twiml.toString();
  }
}

/**
 * Prompts the callee to confirm they are human before connecting.
 * @param {import("express").Request} _req
 * @param {import("express").Response} _res
 * @returns {string}
 */
export function handleInboundScreen(_req, _res) {
  const twiml = new twilio.twiml.VoiceResponse();

  const gather = twiml.gather({
    numDigits: 1,
    timeout: 8,
    action: `${process.env.WEB_URL}/twilio/voice/screen/confirm`,
    method: "POST",
  });

  twiml.pause({ length: 2 });
  gather.say("To accept the call, press 1");

  twiml.say("No input received. Goodbye.");
  twiml.reject();

  return twiml.toString();
}

/**
 * Confirms the inbound screen step and optionally starts call recording.
 * @param {import("express").Request & {body?: TwilioWebhookBody}} req
 * @param {import("express").Response} _res
 * @returns {Promise<string>}
 */
export async function handleInboundScreenConfirm(req, _res) {
  const twiml = new twilio.twiml.VoiceResponse();

  const digits = req.body?.Digits;

  if (digits !== "1") {
    twiml.say("Call not connected. Goodbye.");
    twiml.reject();
    return twiml.toString();
  }

  twiml.say("Connecting.");

  const recordingCallSid = req.body?.CallSid || req.body?.ParentCallSid;
  if (recordingCallSid) {
    try {
      await client.calls(recordingCallSid).recordings.create({
        recordingChannels: "dual",
        recordingStatusCallback: `${process.env.WEB_URL}/twilio/recording-status`,
        recordingStatusCallbackMethod: "POST",
      });
    } catch (e) {
      console.error(
        `Twilio: Failed to start recording for call ${recordingCallSid}`,
        e,
      );
      Sentry.captureException(e);
    }
  } else {
    console.warn(
      "Twilio: Missing CallSid/ParentCallSid; could not start recording after screen confirm.",
    );
  }

  return twiml.toString();
}

/**
 * Handles the Twilio post-dial webhook; records voicemail or posts missed-call info.
 * @param {import("express").Request & {body?: TwilioWebhookBody}} req
 * @param {import("express").Response} _res
 * @returns {Promise<string>}
 */
export async function handleInboundAfterDial(req, _res) {
  const twiml = new twilio.twiml.VoiceResponse();

  const dialStatus = req.body?.DialCallStatus;
  const dialDuration = Number(req.body?.DialCallDuration || 0);
  const wasConnected = dialStatus === "completed" && dialDuration > 0;

  // TODO: Inbound call, hung up during voicemail greeting
  // - This doesn't fire on this situation

  if (wasConnected) {
    twiml.hangup();
    return twiml.toString();
  }
  if (dialStatus === "no-answer") {
    await sendMissedCallBlocks(
      req.body?.From,
      req.body?.To,
      "Hung up before picked up",
    );
    twiml.hangup();
    return twiml.toString();
  }

  const twilioNumber = await prisma.twilioNumber.findUnique({
    where: { id: req.body.To },
  });

  if (twilioNumber && twilioNumber.assignedEmployeeName) {
    twiml.say(
      `Thank you for calling ${twilioNumber.assignedEmployeeName} with Plumb-All. Please leave your name, number, and a brief description of the issue after the tone, and we’ll return your call as soon as possible.`,
    );
  } else {
    twiml.say(
      `Thank you for calling Plumb-All. Please leave your name, number, and a brief description of the issue after the tone, and we’ll return your call as soon as possible.`,
    );
  }

  twiml.record({
    maxLength: 300,
    finishOnKey: "#",
    playBeep: true,
    action: `${process.env.WEB_URL}/twilio/voice/voicemail-action`,
    method: "POST",
    recordingStatusCallback: `${process.env.WEB_URL}/twilio/recording-status`,
    recordingStatusCallbackMethod: "POST",
  });

  return twiml.toString();
}

/**
 * Handles the voicemail action callback and posts a missed-call message if empty.
 * @param {import("express").Request & {body?: TwilioWebhookBody}} req
 * @param {import("express").Response} res
 * @returns {Promise<void>}
 */
export async function handleVoicemailAction(req, res) {
  const duration = Number(req.body?.RecordingDuration || 0);

  if (duration > 0) {
    PostHog.logVoicemail({
      from: req.body?.From,
      to: req.body?.To,
      duration,
    }).catch((e) => {
      Sentry.captureException(e);
      console.error("Twilio: PostHog logVoicemail error:", e);
    });
    res.sendStatus(200);
    return;
  }

  await sendMissedCallBlocks(req.body?.From, req.body?.To, "No voicemail left");

  res.sendStatus(200);
}

/**
 * Prompts an employee to confirm before bridging a call to a customer.
 * @param {import("express").Request} req
 * @param {import("express").Response} _res
 * @returns {Promise<string>}
 */
export async function handleBridge(req, _res) {
  const twiml = new twilio.twiml.VoiceResponse();

  const customer = req.query.to;

  if (!customer) {
    twiml.say("We are unable to connect your call at this time.");
    twiml.hangup();
    return twiml.toString();
  }

  // Ask the employee to confirm they’re a human before connecting to the customer.
  const gather = twiml.gather({
    numDigits: 1,
    timeout: 8,
    action: `/twilio/bridge/confirm?to=${encodeURIComponent(customer)}`,
    method: "POST",
  });

  twiml.pause({ length: 2 });
  gather.say("To connect the call, press 1");

  // If they don't press anything, do NOT connect to the customer.
  twiml.say("No input received. Goodbye.");
  twiml.hangup();

  return twiml.toString();
}

/**
 * Confirms the bridge prompt and dials the customer.
 * @param {import("express").Request & {body?: TwilioWebhookBody}} req
 * @param {import("express").Response} _res
 * @returns {Promise<string>}
 */
export async function handleBridgeConfirm(req, _res) {
  const twiml = new twilio.twiml.VoiceResponse();

  const customer = req.query.to;
  const digits = req.body?.Digits;

  if (!customer) {
    twiml.say("We are unable to connect your call at this time.");
    twiml.hangup();
    return twiml.toString();
  }

  if (digits !== "1") {
    twiml.say("Call not connected. Goodbye.");
    twiml.hangup();
    return twiml.toString();
  }

  const dial = twiml.dial({
    callerId: process.env.TWILIO_CALLER_ID,
    record: "record-from-answer-dual",
    recordingStatusCallback: `${process.env.WEB_URL}/twilio/recording-status`,
    recordingStatusCallbackMethod: "POST",
    action: `${process.env.WEB_URL}/twilio/bridge/after-dial`,
    method: "POST",
  });

  dial.number(customer);

  return twiml.toString();
}

/**
 * Handles the post-dial callback for outbound bridge calls and informs the employee of the outcome.
 * @param {import("express").Request & {body?: TwilioWebhookBody}} req
 * @param {import("express").Response} _res
 * @returns {string}
 */
export function handleBridgeAfterDial(req, _res) {
  const twiml = new twilio.twiml.VoiceResponse();
  const dialStatus = req.body?.DialCallStatus;

  if (dialStatus === "busy") {
    twiml.say("The customer's line is busy. Please try again later.");
  } else if (dialStatus === "no-answer") {
    twiml.say("The customer did not answer. Please try again later.");
  } else if (dialStatus === "failed") {
    twiml.say("The call could not be connected. Please try again later.");
  }

  twiml.hangup();
  return twiml.toString();
}

/**
 * Calls the employee first, then bridges to the customer on acceptance.
 * @param {string} employeePhoneNumber - Employee phone number (any format).
 * @param {string} customerPhoneNumber - Customer phone number (any format).
 * @param {string} slackTs - Slack message timestamp for the thread.
 * @returns {Promise<string>} Twilio call SID.
 */
export async function callEmployeeThenCustomer(
  employeePhoneNumber,
  customerPhoneNumber,
  slackTs,
) {
  // Put the customer number + Slack message id in query params so your webhook can see them
  const twimlUrl = new URL(`${process.env.WEB_URL}/twilio/bridge`);
  twimlUrl.searchParams.set("to", toE164(customerPhoneNumber));

  const assignedTwilioNumber =
    await getOrAssignEmployeeNumber(employeePhoneNumber);

  const call = await client.calls.create({
    to: toE164(employeePhoneNumber),
    from: assignedTwilioNumber.phoneNumber,
    url: twimlUrl.toString(),
    method: "POST",

    // TODO: Setup the caller ID. Something about this needs to be verified
    // callerId: "Plumb-All",
  });

  await updateTwilioContact(
    customerPhoneNumber,
    assignedTwilioNumber.phoneNumber,
    slackTs,
  );

  PostHog.logOutboundCall({
    customerPhone: toE164(customerPhoneNumber),
    employeePhone: toE164(employeePhoneNumber),
    twilioNumber: assignedTwilioNumber.phoneNumber,
    callSid: call.sid,
  }).catch((e) => {
    Sentry.captureException(e);
    console.error("Twilio: PostHog logOutboundCall error:", e);
  });

  return call.sid;
}

/**
 * Sends an SMS to a customer from the employee's assigned Twilio number.
 * @param {string} customerPhoneNumber - Customer phone number (any format).
 * @param {string} employeePhoneNumber - Employee phone number (any format).
 * @param {string} smsMessage - Text body.
 * @param {string | null} [slackTs=null] - Slack thread timestamp.
 * @param mediaUrl The URL of the media file to send
 * @returns {Promise<void>}
 */
export async function textCustomer(
  customerPhoneNumber,
  employeePhoneNumber,
  smsMessage,
  slackTs = null,
  mediaUrl = null,
) {
  const assignedTwilioNumber =
    await getOrAssignEmployeeNumber(employeePhoneNumber);

  const messageParams = {
    to: toE164(customerPhoneNumber),
    from: assignedTwilioNumber.phoneNumber,
    body: smsMessage,
  };
  if (mediaUrl) {
    messageParams.mediaUrl = [mediaUrl];
  }

  await client.messages.create(messageParams);

  PostHog.logOutboundSms({
    customerPhone: toE164(customerPhoneNumber),
    employeePhone: toE164(employeePhoneNumber),
    twilioNumber: assignedTwilioNumber.phoneNumber,
    body: smsMessage,
    hasMedia: !!mediaUrl,
  }).catch((e) => {
    Sentry.captureException(e);
    console.error("Twilio: PostHog logOutboundSms error:", e);
  });

  // TODO: This doesn't update the slack thread ID
  await updateTwilioContact(
    customerPhoneNumber,
    assignedTwilioNumber.phoneNumber,
    slackTs,
  );
}

/**
 * Extracts MMS media URLs from a Twilio webhook payload.
 * @param {TwilioWebhookBody} body
 * @returns {string[]}
 */
function getMediaUrls(body) {
  const numMedia = body.NumMedia;
  if (numMedia === 0) {
    return [];
  }

  const mediaUrls = [];
  for (let i = 0; i < numMedia; i++) {
    if (body[`MediaUrl${i}`]) {
      mediaUrls.push(body[`MediaUrl${i}`]);
    } else {
      console.warn(
        `Twilio SMS: Expecting ${numMedia} media attachments; couldn't access MediaUrl${i}. Body was:\n${JSON.stringify(body)}`,
      );
    }
  }

  return mediaUrls;
}

/**
 * Downloads media URLs and returns buffers and metadata.
 * @param {string[]} mediaUrls
 * @returns {Promise<Array<{url: string, contentType: string, data: Buffer}>>}
 */
async function downloadTwilioMediaUrls(mediaUrls) {
  if (!mediaUrls.length) {
    return [];
  }

  const auth = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`,
  ).toString("base64");

  const downloads = mediaUrls.map(async (mediaUrl) => {
    const resp = await fetch(mediaUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Twilio media download failed (${resp.status}): ${text}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    return {
      url: mediaUrl,
      contentType:
        resp.headers.get("content-type") || "application/octet-stream",
      data: Buffer.from(arrayBuffer),
    };
  });

  return Promise.all(downloads);
}

/**
 * Resolves MMS media attachments (if any).
 * @param {TwilioWebhookBody} body
 * @returns {Promise<Array<{url: string, contentType: string, data: Buffer}> | undefined>}
 */
async function getMedia(body) {
  const mediaUrls = getMediaUrls(body);
  if (mediaUrls.length) {
    return await downloadTwilioMediaUrls(mediaUrls);
  }
}

/**
 * Builds a filename for a media attachment based on its content type.
 * @param {{contentType: string}} media
 * @returns {string}
 */
function buildMediaFilename(media) {
  const prefix = `attachment-${Date.now()}`;

  const ext = extension(media.contentType) || "bin";

  if (ext === "bin") {
    console.warn("Twilio SMS: Couldn't determine file extension!");
  }

  return `${prefix}.${ext}`;
}

/**
 * Handles inbound SMS/MMS from Twilio and posts to Slack.
 * @param {import("express").Request & {body?: TwilioWebhookBody}} req
 * @param {import("express").Response} _res
 * @returns {Promise<string>}
 */
export async function handleInboundSms(req, _res) {
  try {
    const from = req.body?.From; // customer/caller
    const to = req.body?.To; // the Twilio number they dialed

    let twilioContact = await prisma.twilioContact.findUnique({
      where: { id: from },
    });

    let twilioNumber = await prisma.twilioNumber.findUnique({
      where: { id: to },
    });

    // Check if there were any MMS media attachments
    const media = await getMedia(req.body);

    PostHog.logInboundSms({
      from,
      to,
      body: req.body?.Body || null,
      mediaCount: Number(req.body?.NumMedia || 0),
      assignedEmployee: twilioNumber?.assignedEmployee || null,
    }).catch((e) => {
      Sentry.captureException(e);
      console.error("Twilio: PostHog logInboundSms error:", e);
    });

    // Optional: tiny bit of logging context (avoid logging sensitive data in production)
    console.info(
      `Twilio SMS: inbound SMS to=${to} from=${from || "<unknown>"} message=${req.body?.Body}`,
    );

    let text = req.body?.Body;
    if (req.body?.Body === "" && media && media.length > 0) {
      text = "No message provided (attachments only)";
    }

    const threadId =
      twilioContact && twilioContact.slackThreadId
        ? twilioContact.slackThreadId
        : null;

    const blocks = [];
    let smsHeading;
    if (threadId) {
      smsHeading = `SMS From ${from}\n${text}`;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: smsHeading,
        },
      });
    } else {
      const toName = twilioNumber.assignedEmployee
        ? `<@${twilioNumber.assignedEmployee}>`
        : to;

      smsHeading = `SMS To ${toName} From ${from}\n${text}`;
      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: smsHeading,
          },
        },
        {
          type: "divider",
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Call",
              },
              style: "primary",
              value: from,
              action_id: "outbound-call-0",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Text",
              },
              value: from,
              action_id: "outbound-text-0",
            },
          ],
        },
      );
    }

    const slackMessage = await sendMessageBlocks(
      smsHeading,
      blocks,
      "New Call Bot",
      threadId,
      process.env.SLACK_CHANNEL,
    );

    // Set the TwilioContact's slackThreadId (this will allow new inbound conversations to be in-thread)
    await updateTwilioContact(from, to, slackMessage.ts);

    twilioContact = await prisma.twilioContact.findUnique({
      where: { id: from },
    });

    // If there are media attachments, upload them to the thread
    if (media) {
      for (let i = 0; i < media.length; i++) {
        const fileName = buildMediaFilename(media[i]);

        await uploadFile(
          media[i].data,
          fileName,
          "SMS Attachment",
          "SMS Attachment",
          process.env.SLACK_CHANNEL,
          twilioContact.slackThreadId,
        );
      }
    }

    // No SMS response
    return new twilio.twiml.MessagingResponse().toString();
  } catch (e) {
    console.error("Twilio SMS: error handling inbound sms", e);
    Sentry.captureException(e);

    // No SMS response
    return new twilio.twiml.MessagingResponse().toString();
  }
}

/**
 * Handles Twilio recording status callbacks and posts recordings to Slack.
 * @param {import("express").Request & {body?: TwilioWebhookBody}} req
 * @param {import("express").Response} res
 * @returns {Promise<void>}
 */
export async function handleRecordingDone(req, res) {
  const recordingSid = req.body.RecordingSid;
  const recordingCallSid = req.body.CallSid;
  console.log(
    `Twilio: Recording done for call ${recordingCallSid} (recording: ${recordingSid})`,
  );

  // Don't post recordings with duration 0
  if (req.body.RecordingDuration === 0) {
    console.log(
      `Twilio: Recording had duration 0; not posting recording. (Recording SID: ${recordingSid})`,
    );
    return;
  }

  const callRecording = await downloadTwilioRecording(req.body.RecordingUrl);

  const thisCall = await client.calls(recordingCallSid).fetch();
  let call = thisCall;

  console.log(
    `Twilio Recording: thisCall sid=${thisCall.sid} direction=${thisCall.direction} from=${thisCall.from} to=${thisCall.to} parentCallSid=${thisCall.parentCallSid || "none"}`,
  );

  if (thisCall.parentCallSid && thisCall.parentCallSid !== "") {
    call = await client.calls(thisCall.parentCallSid).fetch();
    console.log(
      `Twilio Recording: parentCall sid=${call.sid} direction=${call.direction} from=${call.from} to=${call.to}`,
    );
  }

  let customerNumber;
  let ourNumber;
  let resolutionPath;

  // For an inbound call, we can use the `from` field to look up the sid, otherwise we need to look up the child call
  if (call.direction === "inbound") {
    customerNumber = call.from;
    ourNumber = call.to;
    resolutionPath = "inbound";
  } else if (thisCall.parentCallSid) {
    // Recording fired on the child call — the child dialled the customer
    customerNumber = thisCall.to;
    ourNumber = thisCall.from;
    resolutionPath = "outbound-child";
  } else {
    resolutionPath = "outbound-parent-lookup";
    const childCall = await client.calls.list({
      parent: call.sid,
      limit: 1,
    });

    if (childCall.length === 0) {
      Sentry.captureMessage(
        "Recording handler: no child call found for parent",
        {
          level: "warning",
          extra: {
            parentCallSid: call.sid,
            recordingSid,
            recordingCallSid,
          },
        },
      );
      console.warn(
        `Twilio Recording: No child call found for parent ${call.sid}. Cannot determine customer number.`,
      );
      return;
    }

    call = childCall[0];
    customerNumber = call.to;
    ourNumber = thisCall.from;
    console.log(
      `Twilio Recording: Found child call sid=${call.sid} to=${call.to} from=${call.from}`,
    );
  }

  console.log(
    `Twilio Recording: Resolved via ${resolutionPath} — customer=${customerNumber} our=${ourNumber}`,
  );

  if (customerNumber) {
    const twilioContact = await prisma.twilioContact.findUnique({
      where: {
        id: customerNumber,
      },
    });

    console.log(
      `Twilio Recording: TwilioContact lookup for ${customerNumber}: ${twilioContact ? `found (slackThreadId=${twilioContact.slackThreadId || "null"}, createdAt=${twilioContact.createdAt})` : "NOT FOUND"}`,
    );

    if (twilioContact?.slackThreadId) {
      console.log(
        `Twilio Recording: Uploading to existing thread ${twilioContact.slackThreadId}`,
      );
      events.emit(
        "slackbot-upload-file",
        callRecording,
        `call-recording-${Date.now()}.mp3`,
        "Call recording",
        "Call Recorded",
        process.env.SLACK_CHANNEL,
        twilioContact.slackThreadId,
      );
    } else {
      console.log(
        `Twilio Recording: No slackThreadId — creating new thread for recording`,
      );
      Sentry.captureMessage(
        "Recording handler: no slackThreadId for customer",
        {
          level: "warning",
          extra: {
            customerNumber,
            ourNumber,
            recordingSid,
            recordingCallSid,
            resolutionPath,
            twilioContact: twilioContact ?? null,
            thisCallSid: thisCall.sid,
            thisCallDirection: thisCall.direction,
            thisCallFrom: thisCall.from,
            thisCallTo: thisCall.to,
            thisCallParent: thisCall.parentCallSid || null,
            resolvedCallSid: call.sid,
            resolvedCallDirection: call.direction,
          },
        },
      );
      let twilioNumber = await prisma.twilioNumber.findUnique({
        where: { id: ourNumber },
      });

      const toName = twilioNumber?.assignedEmployee
        ? `<@${twilioNumber.assignedEmployee}>`
        : ourNumber;

      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Call To ${toName} From ${normalizePhoneNumber(customerNumber)}`,
          },
        },
        {
          type: "divider",
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Call",
              },
              style: "primary",
              value: toE164(customerNumber),
              action_id: "outbound-call-0",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Text",
              },
              value: toE164(customerNumber),
              action_id: "outbound-text-0",
            },
          ],
        },
      ];

      events.emit(
        "slackbot-upload-file",
        callRecording,
        `call-recording-${Date.now()}.mp3`,
        "Call recording",
        "Call Recorded",
        process.env.SLACK_CHANNEL,
        null,
        blocks,
        `Call To ${toName} From ${normalizePhoneNumber(customerNumber)}`,
        call,
      );
    }

    PostHog.logCallRecording({
      customerPhone: customerNumber,
      ourNumber,
      direction: call.direction || "unknown",
      duration: Number(req.body.RecordingDuration || 0),
      callSid: req.body.CallSid,
    }).catch((e) => {
      Sentry.captureException(e);
      console.error("Twilio: PostHog logCallRecording error:", e);
    });

    console.log("Twilio: Deleting recording from twilio");
    await client.recordings(req.body.RecordingSid).remove();
  } else {
    const errorMessage = `Twilio: No customer number found for call ${req.body.CallSid}`;
    console.error(errorMessage);
    Sentry.captureException(new Error(errorMessage));
  }

  res.status(200).send();
}

/**
 * Fetches all Twilio incoming phone numbers and upserts them into TwilioNumber.
 * @returns {Promise<void>}
 */
async function updateTwilioNumbers() {
  // Twilio's SDK paginates internally for `.list()` (it will fetch multiple pages up to `limit`).
  const ownedNumbers = await client.incomingPhoneNumbers.list({
    // keep this high; adjust if you ever have an unusually large inventory
    limit: 20000,
    pageSize: 1000,
  });

  const ops = [];
  for (const n of ownedNumbers) {
    const e164 = n.phoneNumber;
    if (!e164) continue;

    ops.push(
      prisma.twilioNumber.upsert({
        where: { id: e164 },
        update: { phoneNumber: e164 },
        create: { id: e164, phoneNumber: e164 },
      }),
    );

    console.info(`Twilio: Upserted twilio phone number ${e164}`);
  }

  await prisma.$transaction(ops);
}

console.info("Twilio: Updating Phone Numbers");
updateTwilioNumbers().then(() => console.info("Twilio: Updated Phone Numbers"));
