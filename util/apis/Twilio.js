import twilio from "twilio";
import { PrismaClient } from "../../generated/prisma/index.js";
import { normalizePhoneNumber, toE164 } from "../DataUtilities.js";
import fetch from "node-fetch";
import events from "../events.js";

const prisma = new PrismaClient();
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

/**
 * Automatically assigns a Twilio number to an employee the first time they try to call/text.
 *
 * Flow:
 * 1) If employee already has a TwilioNumber (assignedEmployeeNumber = employee E.164), return it
 * 2) Else find the first unassigned TwilioNumber
 * 3) Assign it to the employee
 * 4) Return it
 *
 * Concurrency note:
 * - Uses a transaction + conditional update to avoid two employees grabbing the same number.
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
        // Step 4: return the newly-assigned number
        return { phoneNumber: candidate.phoneNumber };
      }
    },
    {
      // Postgres: helps reduce weird edge cases under concurrency
      isolationLevel: "Serializable",
    },
  );

  if (!result) {
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
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  try {
    const from = req.body?.From; // customer/caller
    const to = req.body?.To; // the Twilio number they dialed

    const fallbackNumber = process.env.TWILIO_FALLBACK_NUMBER;

    if (!to) {
      twiml.say("We are unable to route your call at this time.");
      twiml.dial({}, fallbackNumber);

      console.error(`Twilio: Missing the number they dialed`);
      // Sentry.captureException(e);

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
    });

    dial.number(dialTarget);

    // TODO: Implement a simple voicemail recording thing if the call is unanswered or busy

    await updateTwilioContact(from, to, null);

    return twiml.toString();
  } catch (e) {
    console.error("Twilio Voice: error handling inbound call", e);
    // Sentry.captureException(e);

    twiml.dial({}, process.env.TWILIO_FALLBACK_NUMBER);
    return twiml.toString();
  }
}

export async function handleBridge(req, res) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

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
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

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
  // Put the customer number + slack message id in query params so your webhook can see them
  const twimlUrl = new URL(`${process.env.WEB_URL}/twilio/bridge`);
  twimlUrl.searchParams.set("to", toE164(customerPhoneNumber));

  const assignedTwilioNumber =
    await getOrAssignEmployeeNumber(employeePhoneNumber);

  // TODO: Ensure the employee picked up the phone
  //       If we don't check for this, the call can connect a voicemail
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

  const now = new Date();

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

  const now = new Date();

  // TODO: This doesn't update the slack thread ID
  await updateTwilioContact(
    customerPhoneNumber,
    assignedTwilioNumber.phoneNumber,
    slackTs,
  );
}

export async function handleInboundSms(req, res) {
  // const VoiceResponse = twilio.twiml.VoiceResponse;
  // const twiml = new VoiceResponse();

  try {
    const from = req.body?.From; // customer/caller
    const to = req.body?.To; // the Twilio number they dialed

    const twilioContact = await prisma.twilioContact.findUnique({
      where: { id: from },
    });

    // Optional: tiny bit of logging context (avoid logging sensitive data in production)
    console.info(
      `Twilio SMS: inbound SMS to=${to} from=${from || "<unknown>"} message=${req.body?.Body}`,
    );

    // TODO: Send the message to Slack
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `SMS From ${from}\n${req.body?.Body}`,
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
    events.emit(
      "slackbot-send-message-blocks",
      blocks,
      "New Call Bot",
      twilioContact.slackThreadId,
      process.env.SLACK_CHANNEL,
    );

    await updateTwilioContact(from, to, null);
  } catch (e) {
    console.error("Twilio SMS: error handling inbound sms", e);
    // Sentry.captureException(e);
  }
}

export async function handleRecordingDone(req, res) {
  console.log(`Twilio: Recording done for call ${req.body.CallSid}`);

  const callRecording = await downloadTwilioRecording(req.body.RecordingUrl);

  const thisCall = await client.calls(req.body.CallSid).fetch();
  let call = thisCall;

  let customerNumber = null;

  // For an inbount call, we can use the `from` field to lookup the sid, otherwise we need to lookup the child call
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
 * Pull all phone numbers the account owns, then upsert into TwilioNumber table.
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
