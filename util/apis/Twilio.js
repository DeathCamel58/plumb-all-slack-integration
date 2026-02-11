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
import { extension } from "mime-types";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

export async function unassignNumber(phoneNumber) {
  console.log("Twilio: Unassigning number " + phoneNumber);

  await prisma.twilioNumber.update({
    where: {
      id: phoneNumber,
    },
    data: {
      assignedEmployee: "",
      assignedEmployeeNumber: "",
    },
  });
}

export async function returnAssignedPhoneNumbers() {
  // Check in DB for any unassigned numbers
  const unassignedNumbers = await prisma.twilioNumber.findMany({
    where: {
      assignedEmployee: "",
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
 * Automatically assigns a Twilio number to an employee the first time they try to call/text.
 *
 * Flow:
 * 1) If an employee already has a TwilioNumber (assignedEmployeeNumber = employee E.164), return it
 * 2) Else find the first unassigned TwilioNumber
 * 3) Assign it to the employee
 * 4) Return it
 *
 * Concurrency note:
 * - Uses a transaction and conditional update to avoid two employees grabbing the same number.
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
          assignedEmployeeNumber: "",
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
          assignedEmployeeNumber: "",
        },
        data: {
          assignedEmployeeNumber: employeeE164,
        },
      });

      if (updated.count === 1) {
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
    Sentry.captureException(
      new Error("Failed to assign Twilio number, no numbers available."),
    );

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

export async function updateTwilioContactTs(call, threadTs) {
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

export async function handleInboundCall(req, res) {
  const twiml = new twilio.twiml.VoiceResponse();

  try {
    const from = req.body?.From; // customer/caller
    const to = req.body?.To; // the Twilio number they dialed

    const fallbackNumber = process.env.TWILIO_FALLBACK_NUMBER;

    if (!to) {
      twiml.say("We are unable to route your call at this time.");
      twiml.dial({}, fallbackNumber);

      console.error(`Twilio: Missing the number they dialed`);

      Sentry.captureException(
        new Error("Twilio: Missing the number they dialed"),
      );

      return twiml.toString();
    }

    const twilioNumber = await prisma.twilioNumber.findUnique({
      where: { id: to },
    });

    const employeeNumber =
      twilioNumber?.assignedEmployeeNumber ||
      twilioNumber?.assignedEmployee ||
      null;

    const dialTarget = employeeNumber || fallbackNumber;

    // Optional: tiny bit of logging context (avoid logging sensitive data in production)
    console.info(
      `Twilio Voice: inbound call to=${to} from=${from || "<unknown>"} routingTo=${dialTarget}`,
    );

    const dial = twiml.dial({
      callerId: to, // present the dialed Twilio number to the recipient
      answerOnBridge: true,
      record: "record-from-answer",
      recordingChannels: "dual",
      // Optional callbacks if you want to store recording URLs later:
      recordingStatusCallback: `${process.env.WEB_URL}/twilio/recording-status`,
      recordingStatusCallbackMethod: "POST",
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
  } catch (e) {
    console.error("Twilio Voice: error handling inbound call", e);
    Sentry.captureException(e);

    twiml.dial({}, process.env.TWILIO_FALLBACK_NUMBER);
    return twiml.toString();
  }
}

export function handleInboundScreen(req, res) {
  const twiml = new twilio.twiml.VoiceResponse();

  const gather = twiml.gather({
    numDigits: 1,
    timeout: 6,
    action: `${process.env.WEB_URL}/twilio/voice/screen/confirm`,
    method: "POST",
  });

  gather.say("Press 1 to accept the call.");

  twiml.say("No input received. Goodbye.");
  twiml.reject();

  return twiml.toString();
}

export function handleInboundScreenConfirm(req, res) {
  const twiml = new twilio.twiml.VoiceResponse();

  const digits = req.body?.Digits;

  if (digits !== "1") {
    twiml.say("Call not connected. Goodbye.");
    twiml.reject();
    return twiml.toString();
  }

  twiml.say("Connecting.");

  return twiml.toString();
}

export function handleInboundAfterDial(req, res) {
  const twiml = new twilio.twiml.VoiceResponse();

  const dialStatus = req.body?.DialCallStatus;
  const dialDuration = Number(req.body?.DialCallDuration || 0);
  const wasConnected = dialStatus === "completed" && dialDuration > 0;

  if (wasConnected) {
    twiml.hangup();
    return twiml.toString();
  }

  twiml.say("Please leave a message after the tone.");
  twiml.record({
    maxLength: 300,
    finishOnKey: "#",
    playBeep: true,
    recordingStatusCallback: `${process.env.WEB_URL}/twilio/recording-status`,
    recordingStatusCallbackMethod: "POST",
  });

  return twiml.toString();
}

export async function handleBridge(req, res) {
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
    timeout: 6,
    action: `/twilio/bridge/confirm?to=${encodeURIComponent(customer)}`,
    method: "POST",
  });

  gather.say("Press 1 to connect the call.");

  // If they don't press anything, do NOT connect to the customer.
  twiml.say("No input received. Goodbye.");
  twiml.hangup();

  return twiml.toString();
}

export async function handleBridgeConfirm(req, res) {
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
    recordingStatusCallback: `${process.env.WEB_URL}/twilio/recording-status`,
    recordingStatusCallbackMethod: "POST",
  });

  dial.number(customer);

  return twiml.toString();
}

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

    // machineDetection: "Enable",

    // TODO: Setup the caller ID. Something about this needs to be verified
    // callerId: "Plumb-All",

    // Optional: status callbacks so you can log outcomes
    // statusCallback: `${process.env.WEB_URL}/twilio/status`,
    // statusCallbackMethod: "POST",
    // statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],

    // Optional: record the bridged call
    record: true,
    // recordingChannels: "dual", // depending on account defaults; dual is commonly available

    recordingStatusCallback: `${process.env.WEB_URL}/twilio/recording-status`,
    recordingStatusCallbackMethod: "POST",
  });

  await updateTwilioContact(
    customerPhoneNumber,
    assignedTwilioNumber.phoneNumber,
    slackTs,
  );

  return call.sid;
}

export async function textCustomer(
  customerPhoneNumber,
  employeePhoneNumber,
  smsMessage,
  slackTs = null,
) {
  const assignedTwilioNumber =
    await getOrAssignEmployeeNumber(employeePhoneNumber);

  await client.messages.create({
    to: toE164(customerPhoneNumber),
    from: assignedTwilioNumber.phoneNumber,
    body: smsMessage,
  });

  // TODO: This doesn't update the slack thread ID
  await updateTwilioContact(
    customerPhoneNumber,
    assignedTwilioNumber.phoneNumber,
    slackTs,
  );
}

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

  // There can only be up to 10 media URLs

  return mediaUrls;
}

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

async function getMedia(body) {
  const mediaUrls = getMediaUrls(body);
  if (mediaUrls.length) {
    return await downloadTwilioMediaUrls(mediaUrls);
  }
}

function buildMediaFilename(media) {
  const prefix = `attachment-${Date.now()}`;

  const ext = extension(media.contentType) || "bin";

  if (ext === "bin") {
    console.warn("Twilio SMS: Couldn't determine file extension!");
  }

  return `${prefix}.${ext}`;
}

export async function handleInboundSms(req, res) {
  // const VoiceResponse = twilio.twiml.VoiceResponse;
  // const twiml = new VoiceResponse();

  try {
    const from = req.body?.From; // customer/caller
    const to = req.body?.To; // the Twilio number they dialed

    let twilioContact = await prisma.twilioContact.findUnique({
      where: { id: from },
    });

    // Check if there were any MMS media attachments
    const media = await getMedia(req.body);

    // Optional: tiny bit of logging context (avoid logging sensitive data in production)
    console.info(
      `Twilio SMS: inbound SMS to=${to} from=${from || "<unknown>"} message=${req.body?.Body}`,
    );

    let text = req.body?.Body;
    if (req.body?.Body === "" && media && media.length > 0) {
      text = "No message provided (attachments only)";
    }

    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `SMS From ${from}\n${text}`,
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
    ];
    const threadId =
      twilioContact && twilioContact.slackThreadId
        ? twilioContact.slackThreadId
        : null;

    const slackMessage = await sendMessageBlocks(
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
  } catch (e) {
    console.error("Twilio SMS: error handling inbound sms", e);
    Sentry.captureException(e);
  }
}

export async function handleRecordingDone(req, res) {
  console.log(`Twilio: Recording done for call ${req.body.CallSid}`);

  const callRecording = await downloadTwilioRecording(req.body.RecordingUrl);

  const thisCall = await client.calls(req.body.CallSid).fetch();
  let call = thisCall;

  let customerNumber;

  // For an inbount call, we can use the `from` field to look up the sid, otherwise we need to look up the child call
  if (thisCall.direction === "inbound") {
    customerNumber = thisCall.from;
  } else {
    const childCall = await client.calls.list({
      parent: req.body.CallSid,
      limit: 1,
    });

    call = childCall[0];
    customerNumber = call.to;
  }

  if (customerNumber) {
    const twilioContact = await prisma.twilioContact.findFirst({
      where: {
        clientNumber: customerNumber,
      },
      orderBy: {
        lastContactAt: "desc",
      },
    });

    if (twilioContact.slackThreadId) {
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
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Call from ${normalizePhoneNumber(customerNumber)}`,
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
        twilioContact.slackThreadId,
        blocks,
        call,
      );
    }
  } else {
    console.error(
      `Twilio: No customer number found for call ${req.body.CallSid}`,
    );
  }

  res.status(200).send();
}

/**
 * Pull all phone numbers the account owns, then upsert into the TwilioNumber table.
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
updateTwilioNumbers().then((r) =>
  console.info("Twilio: Updated Phone Numbers"),
);
