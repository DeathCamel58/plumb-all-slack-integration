import Slack from "@slack/bolt";
import * as crypto from "crypto";
import * as Jobber from "./Jobber.js";
import { interleave, toE164 } from "../DataUtilities.js";
import events from "../events.js";
import * as Sentry from "@sentry/node";
import { findUserInvoices, findUserJobs } from "./Jobber.js";
import prisma from "../prismaClient.js";
import {
  callEmployeeThenCustomer,
  getOrAssignEmployeeNumber,
  returnAssignedPhoneNumbers,
  textCustomer,
  unassignNumber,
  updateTwilioContact,
  updateTwilioContactTs,
} from "./Twilio.js";
import fetch from "node-fetch";
import { hostFile } from "../mediaStore.js";

const slackCallChannelName = process.env.SLACK_CHANNEL || "calls";

const app = new Slack.App({
  signingSecret: process.env.SLACK_SIGNING_SECRET || "",
  token: process.env.SLACK_TOKEN || "",
});

// Log into Slack and such
(async () => {
  // Start your app
  await app.start(3000);

  console.info("Slack: Logged into Slack!");
})();

/**
 * Resolves a channel ID (C..., G...) or channel name ("calls" or "#calls") to an ID.
 * @param {string} channelOrName
 * @returns {Promise<string | null>}
 */
async function resolveChannelId(channelOrName) {
  if (!channelOrName) throw new Error("Missing Slack channel");

  // If it already looks like an ID, keep it.
  if (/^[CGD][A-Z0-9]{8,}$/.test(channelOrName)) return channelOrName;

  const result = await app.client.conversations.list();
  const channels = result.channels;

  const channel = channels.find((ch) => ch.name === channelOrName);

  if (channel) {
    return channel.id;
  } else {
    return null;
  }
}

/**
 * Checks whether the user is an admin or owner in the workspace.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isUserAdmin(userId) {
  const userInfo = await app.client.users.info({
    user: userId,
  });

  return userInfo?.user?.is_admin || userInfo?.user?.is_owner || false;
}

/**
 * Finds a Slack user by phone number using profile fields.
 * @param {string} phoneNumber
 * @returns {Promise<any | null>} Slack user object or null if not found.
 */
export async function resolveUserByPhoneNumber(phoneNumber) {
  console.log(`SlackBot: Resolving user for phone number ${phoneNumber}`);

  const normalize = (value) => {
    if (!value) return null;
    try {
      return toE164(value);
    } catch {
      return String(value).replace(/[^\d+]/g, "");
    }
  };

  const target = normalize(phoneNumber);
  if (!target) return null;

  try {
    let cursor;
    do {
      const resp = await app.client.users.list({
        limit: 200,
        cursor: cursor,
      });

      if (!resp?.ok) {
        console.warn(
          `SlackBot: users.list failed: ${resp?.error || "unknown_error"}`,
        );
        return null;
      }

      const members = resp.members || [];
      for (const member of members) {
        // Skip deleted users and bots/app users
        if (!member || member.deleted || member.is_bot || member.is_app_user) {
          continue;
        }

        let userResponse = await app.client.users.profile.get({
          user: member.id,
        });

        const profile = userResponse?.profile || {};

        // Standard Slack profile phone field
        let profilePhone = normalize(profile?.phone);

        if (profilePhone === target) {
          console.log(
            `SlackBot: Found matching Slack user ${member.id} for phone ${target}`,
          );
          return member;
        }

        // Another Slack profile phone field
        profilePhone = normalize(profile?.fields?.Xf03M22Q81Q8?.value);

        if (profilePhone === target) {
          console.log(
            `SlackBot: Found matching Slack user ${member.id} for phone ${target}`,
          );
          return member;
        }
      }

      cursor = resp?.response_metadata?.next_cursor || null;
    } while (cursor);

    console.log(`SlackBot: No Slack user matched phone number ${target}`);
    return null;
  } catch (error) {
    Sentry.captureException(error);
    console.error("SlackBot: resolveUserByPhoneNumber failed", error);
    return null;
  }
}

/**
 * Publishes the app home view for a user.
 * @param {string} user_id
 * @returns {Promise<void>}
 */
async function publishHome(user_id) {
  const assignedNumbers = await returnAssignedPhoneNumbers();

  const assignedNumbersRows = [];

  const isAdmin = await isUserAdmin(user_id);

  assignedNumbersRows.push(
    {
      type: "divider",
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Assigned Phone Numbers*",
      },
    },
  );

  for (const number of assignedNumbers) {
    assignedNumbersRows.push({
      type: "divider",
    });

    let assignedNumbersControls = [];
    if (isAdmin) {
      assignedNumbersControls = {
        // TODO: Allow manual assignment of users
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "Unassign User",
          },
          value: number.id,
          action_id: "unassign-number-0",
        },
      };
    }

    let assignedEmployee = "Couldn't Find User";
    if (!number.assignedEmployee && !number.assignedEmployeeNumber) {
      assignedEmployee = "Unassigned";
    } else {
      assignedEmployee = `<@${number.assignedEmployee}>`;
    }

    assignedNumbersRows.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${number.phoneNumber}*\n*Assigned to:* ${assignedEmployee}`,
      },
      ...assignedNumbersControls,
    });
  }

  const homeBlocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Welcome!*\nThis is the home for Plumb-All's Slack Integration.",
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
            text: "Get open jobs as message",
            emoji: true,
          },
          value: "get_open_jobs",
          action_id: "get-open-jobs-0",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Get my jobs",
            emoji: true,
          },
          value: "get_my_jobs",
          action_id: "get-my-jobs-0",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Get my invoices",
            emoji: true,
          },
          value: "get_my_invoices",
          action_id: "get-my-invoices-0",
        },
      ],
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
            text: "Make a call",
            emoji: true,
          },
          value: "new_outbound_call",
          action_id: "new-outbound-call-0",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Send a text",
            emoji: true,
          },
          value: "new_outbound_sms",
          action_id: "new-outbound-sms-0",
        },
      ],
    },
    ...assignedNumbersRows,
  ];

  await app.client.views.publish({
    user_id: user_id,
    view: {
      type: "home",
      title: {
        type: "plain_text",
        text: "Home",
      },
      blocks: homeBlocks,
    },
  });
}

/**
 * Sends a plain-text message to Slack.
 * @param {string} message
 * @param {string} username
 * @param {string} [channelName=slackCallChannelName]
 * @returns {Promise<any | null>} Slack API result or null on failure.
 */
async function sendMessage(
  message,
  username,
  channelName = slackCallChannelName,
) {
  console.info(message);

  try {
    const result = await app.client.chat.postMessage({
      channel: channelName,
      text: message,
      unfurl_links: false,
      username: username,
      icon_url:
        "https://plumb-all.com/wp-content/uploads/2018/08/cropped-icon.png",
    });

    console.info("Slack: Sent Message to Slack!");
    return result;
  } catch (error) {
    Sentry.captureException(error);
    console.error(error);
    return null;
  }
}
events.on("slackbot-send-message", sendMessage);

/**
 * Sends a direct message to a Slack user by user ID.
 * @param {string} userId
 * @param {string} message
 * @returns {Promise<any | null>}
 */
export async function sendDirectMessage(userId, message) {
  if (!userId || !message) {
    console.warn("Slack: sendDirectMessage missing userId or message");
    return null;
  }

  try {
    const dm = await app.client.conversations.open({
      users: userId,
    });

    const channelId = dm?.channel?.id;
    if (!channelId) {
      console.warn("Slack: Failed to open DM channel", dm);
      return null;
    }

    const result = await app.client.chat.postMessage({
      channel: channelId,
      text: message,
      unfurl_links: false,
    });

    console.info(`Slack: Sent DM to ${userId}`);
    return result;
  } catch (error) {
    Sentry.captureException(error);
    console.error("Slack: sendDirectMessage failed", error);
    return null;
  }
}
events.on("slack-direct-message", sendDirectMessage);

/**
 * Sends a block-based message to Slack.
 * @param {Array<object>} blocks
 * @param {string} username
 * @param {string | null} [threadTs=null]
 * @param {string} [channelName=slackCallChannelName]
 * @returns {Promise<any | null>} Slack API result or null on failure.
 */
export async function sendMessageBlocks(
  blocks,
  username,
  threadTs = null,
  channelName = slackCallChannelName,
) {
  try {
    const result = await app.client.chat.postMessage({
      channel: channelName,
      blocks: blocks,
      unfurl_links: false,
      username: username,
      thread_ts: threadTs,
      icon_url:
        "https://plumb-all.com/wp-content/uploads/2018/08/cropped-icon.png",
    });

    console.info("Slack: Sent Message to Slack!");
    return result;
  } catch (error) {
    Sentry.captureException(error);
    console.error(error);
    return null;
  }
}
events.on("slackbot-send-message-blocks", sendMessageBlocks);

/**
 * Uploads a file to Slack and optionally creates a thread to attach it to.
 * @param {Buffer} fileBuffer
 * @param {string} fileName
 * @param {string} title
 * @param {string} initialComment
 * @param {string} [channelName=slackCallChannelName]
 * @param {string | null} [threadTs=null]
 * @param {Array<object> | null} [blocks=null] - Optional blocks to create a thread.
 * @param {any | null} [call=null] - Call metadata used to update thread id.
 * @returns {Promise<any | null>}
 */
export async function uploadFile(
  fileBuffer,
  fileName,
  title,
  initialComment,
  channelName = slackCallChannelName,
  threadTs = null,
  blocks = null,
  call = null,
) {
  try {
    const channelId = await resolveChannelId(channelName);

    // If there isn't a thread for this, create the thread
    let message;
    if (blocks) {
      message = await app.client.chat.postMessage({
        channel: channelName,
        blocks: blocks,
        unfurl_links: false,
        username: "Call Contact",
        icon_url:
          "https://plumb-all.com/wp-content/uploads/2018/08/cropped-icon.png",
      });
      threadTs = message.ts;

      await updateTwilioContactTs(call, threadTs);
    }

    const result = await app.client.files.uploadV2({
      channel_id: channelId,
      thread_ts: threadTs,
      filename: fileName,
      title: title,
      file: fileBuffer,
      initial_comment: initialComment,
    });

    console.info("Slack: Uploaded file to Slack!");

    return result;
  } catch (error) {
    Sentry.captureException(error);
    console.error(error);

    return null;
  }
}
events.on("slackbot-upload-file", uploadFile);

/**
 * Sends a contact message with call/text actions to Slack.
 * @param {{messageToSend: () => string, phone: string}} contact
 * @param {string} username
 * @param {string} [channelName=slackCallChannelName]
 * @param {string | null} [thread_ts=null]
 * @returns {Promise<void>}
 */
async function sendContactMessage(
  contact,
  username,
  channelName = slackCallChannelName,
  thread_ts = null,
) {
  console.info(contact.messageToSend());

  try {
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: contact.messageToSend(),
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
            value: contact.phone,
            action_id: "outbound-call-0",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Text",
            },
            value: contact.phone,
            action_id: "outbound-text-0",
          },
        ],
      },
    ];
    await app.client.chat.postMessage({
      channel: channelName,
      thread_ts: thread_ts,
      blocks: blocks,
      unfurl_links: false,
      username: username,
      icon_url:
        "https://plumb-all.com/wp-content/uploads/2018/08/cropped-icon.png",
    });

    console.info("Slack: Sent Message to Slack!");
  } catch (error) {
    Sentry.captureException(error);
    console.error(error);
  }
}
events.on("slackbot-send-contact", sendContactMessage);

/**
 * Validates inputs and starts the outbound call flow, returning a user message.
 * @param {{userId: string, employeePhoneNumber: string, rawCustomerNumber: string}} params
 * @returns {Promise<{ok: boolean, userMessage: string}>}
 */
async function startOutboundCallFlow({
  userId,
  employeePhoneNumber,
  rawCustomerNumber,
}) {
  if (!rawCustomerNumber) {
    return {
      ok: false,
      userMessage:
        "I couldn't start the call because the phone number was missing.",
    };
  }

  if (!employeePhoneNumber) {
    return {
      ok: false,
      userMessage:
        "I couldn't start the call because your Slack profile doesn't have a valid phone number. Add one in Slack profile settings and try again.",
    };
  }

  let customerPhoneNumber = rawCustomerNumber;
  try {
    customerPhoneNumber = toE164(rawCustomerNumber);
  } catch (error) {
    return {
      ok: false,
      userMessage:
        "I couldn't start the call because the phone number looked invalid. Try again with a valid phone number.",
    };
  }

  try {
    let slackThreadId;
    const existingContact = await prisma.twilioContact.findUnique({
      where: { id: customerPhoneNumber },
    });

    if (existingContact) {
      slackThreadId = existingContact.slackThreadId || null;
    } else {
      const outboundBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Outbound call requested by <@${userId}> to ${customerPhoneNumber}`,
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
              value: customerPhoneNumber,
              action_id: "outbound-call-0",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Text",
              },
              value: customerPhoneNumber,
              action_id: "outbound-text-0",
            },
          ],
        },
      ];

      const slackMessage = await sendMessageBlocks(
        outboundBlocks,
        "New Call Bot",
        null,
        process.env.SLACK_CHANNEL || slackCallChannelName,
      );

      slackThreadId = slackMessage?.ts || null;

      const assignedTwilioNumber =
        await getOrAssignEmployeeNumber(employeePhoneNumber);

      await updateTwilioContact(
        customerPhoneNumber,
        assignedTwilioNumber.phoneNumber,
        slackThreadId,
      );
    }

    const sid = await callEmployeeThenCustomer(
      employeePhoneNumber,
      customerPhoneNumber,
      slackThreadId,
    );

    return {
      ok: true,
      userMessage: `Placing your call now to ${customerPhoneNumber}. (ref: ${sid})`,
    };
  } catch (e) {
    Sentry.captureException(e);
    console.error("Slack: outbound call failed", e);

    return {
      ok: false,
      userMessage:
        "Sorry — the outbound call failed to start. Please try again, or contact an admin.",
    };
  }
}

/**
 * Validates inputs and starts the outbound SMS flow, returning a user message.
 * If no existing contact thread exists, posts an "Outbound SMS" card to the calls channel.
 * @param {{userId: string, employeePhoneNumber: string, rawCustomerNumber: string, smsMessage: string, mediaUrl?: string|null}} params
 * @returns {Promise<{ok: boolean, userMessage: string}>}
 */
async function startOutboundSmsFlow({
  userId,
  employeePhoneNumber,
  rawCustomerNumber,
  smsMessage,
  mediaUrl = null,
}) {
  if (!rawCustomerNumber) {
    return {
      ok: false,
      userMessage:
        "I couldn't send the SMS because the phone number was missing.",
    };
  }

  if (!employeePhoneNumber) {
    return {
      ok: false,
      userMessage:
        "I couldn't send the SMS because your Slack profile doesn't have a valid phone number. Add one in Slack profile settings and try again.",
    };
  }

  let customerPhoneNumber = rawCustomerNumber;
  try {
    customerPhoneNumber = toE164(rawCustomerNumber);
  } catch (error) {
    return {
      ok: false,
      userMessage:
        "I couldn't send the SMS because the phone number looked invalid. Try again with a valid phone number.",
    };
  }

  try {
    let slackThreadId;
    const existingContact = await prisma.twilioContact.findUnique({
      where: { id: customerPhoneNumber },
    });

    if (existingContact) {
      slackThreadId = existingContact.slackThreadId || null;
    } else {
      const outboundBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Outbound SMS sent by <@${userId}> to ${customerPhoneNumber}`,
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
              value: customerPhoneNumber,
              action_id: "outbound-call-0",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Text",
              },
              value: customerPhoneNumber,
              action_id: "outbound-text-0",
            },
          ],
        },
      ];

      const slackMessage = await sendMessageBlocks(
        outboundBlocks,
        "New Call Bot",
        null,
        process.env.SLACK_CHANNEL || slackCallChannelName,
      );

      slackThreadId = slackMessage?.ts || null;

      const assignedTwilioNumber =
        await getOrAssignEmployeeNumber(employeePhoneNumber);

      await updateTwilioContact(
        customerPhoneNumber,
        assignedTwilioNumber.phoneNumber,
        slackThreadId,
      );
    }

    await textCustomer(
      customerPhoneNumber,
      employeePhoneNumber,
      smsMessage,
      slackThreadId,
      mediaUrl,
    );

    return {
      ok: true,
      userMessage: `SMS sent to ${customerPhoneNumber}.`,
    };
  } catch (e) {
    Sentry.captureException(e);
    console.error("Slack: outbound SMS failed", e);

    return {
      ok: false,
      userMessage:
        "Sorry — the outbound SMS failed to send. Please try again, or contact an admin.",
    };
  }
}

/**
 * Posts a threaded reply with blocks using the original event data.
 * @param {{channel: string, ts: string}} event
 * @param {string} rawMessage
 * @param {Array<object>} blocks
 * @returns {Promise<void>}
 */
async function sendReplyRawMessageBlocks(event, rawMessage, blocks) {
  try {
    await app.client.chat.postMessage({
      // Needed to reply in a thread
      channel: event.channel,
      thread_ts: event.ts,

      // The text to display if the attachments can't be
      text: rawMessage,

      // The blocks to send
      blocks: blocks,
      unfurl_links: false,

      // Display account to use
      username: "Jobber References",
      icon_url:
        "https://plumb-all.com/wp-content/uploads/2018/08/cropped-icon.png",
    });

    console.info("Slack: Linked references in message!");
  } catch (error) {
    Sentry.captureException(error);
    console.error(error);
  }
}

/**
 * Fetches a single message by channel id and timestamp.
 * @param {string} id
 * @param {string} ts
 * @returns {Promise<any>}
 */
async function fetchMessage(id, ts) {
  try {
    // Call the conversations.history method using the built-in WebClient
    const result = await app.client.conversations.history({
      // The token you used to initialize your app
      token: process.env.SLACK_TOKEN || "",
      channel: id,
      // In a more realistic app, you may store ts data in a db
      latest: ts,
      // Limit results
      inclusive: true,
      limit: 1,
    });

    // There should only be one result (stored in the zeroth index)
    // Return the message
    return result.messages[0];
  } catch (error) {
    Sentry.captureException(error);
    console.error(error);
  }
}

/**
 * Detects Jobber references in a message and replies in-thread with details.
 * @param {{user: string, text: string, channel: string, ts: string}} event
 * @returns {Promise<void>}
 */
async function unfurlMessage(event) {
  console.info(`Slack: Message created!\n\t${event.user}\n\t${event.text}`);

  // The found Quotes, Jobs, and Invoices get stored here
  let needToUnfurl = {
    quotes: [],
    jobs: [],
    invoices: [],
  };

  // The blocks to render in the message in Slack
  let blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Found these Jobber items referenced:",
      },
    },
  ];

  // Check for references in multiple formats and add them to `needToUnfurl`
  // Remove all user references first, as user references can make the regex return a false positive
  let tmp = event.text.replace(/<@.{11}>/gi, "");
  // - Q[number], J[number], I[number]
  // - Q#[number], J#[number], I#[number]
  // - Quote [number], Job [number], Invoice [number]
  // - Quote #[number], Job #[number], Invoice #[number]
  tmp = tmp.match(/(QUOTE|JOB|INVOICE|Q|J|I)+ *#* *(\d+)/gi);
  if (tmp) {
    for (let i = 0; i < tmp.length; i++) {
      let number = tmp[i].match(/\d+/g)[0];

      // Check what type this references, and push it into the proper array
      switch (tmp[i][0]) {
        case "Q":
        case "q":
          let quote = await Jobber.getQuoteSearchData("quoteNumber", number);
          needToUnfurl.quotes.push(quote);
          break;
        case "J":
        case "j":
          let job = await Jobber.getJobSearchData(number);
          needToUnfurl.jobs.push(job);
          break;
        case "I":
        case "i":
          let invoice = await Jobber.getInvoiceSearchData(number);
          needToUnfurl.invoices.push(invoice);
          break;
        default:
          console.warn(
            `Slack: Didn't push unfurl reference into array. String didn't start with [QqJjIi]: ${tmp[i]}`,
          );
          break;
      }
    }
  }

  if (
    !(
      needToUnfurl.quotes.length === 0 &&
      needToUnfurl.jobs.length === 0 &&
      needToUnfurl.invoices.length === 0
    )
  ) {
    // Unfurl found references
    for (let i = 0; i < needToUnfurl.quotes.length; i++) {
      if (needToUnfurl.quotes[i] !== null) {
        let dateTime = new Date(needToUnfurl.quotes[i].createdAt);
        let dateToPrint = `${dateTime.toLocaleDateString()} ${dateTime.toLocaleTimeString()}`;
        let total = needToUnfurl.quotes[i].amounts.total;
        let totalToPrint = total.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        });
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Quote #${needToUnfurl.quotes[i].quoteNumber}*\n*Client:* ${needToUnfurl.quotes[i].client.name}\n*Total:* ${totalToPrint}\n*Date:* ${dateToPrint}`,
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              emoji: true,
              text: ":globe_with_meridians: View",
            },
            url: needToUnfurl.quotes[i].jobberWebUri,
          },
        });
      }
    }
    for (let i = 0; i < needToUnfurl.jobs.length; i++) {
      if (needToUnfurl.jobs[i] !== null) {
        let dateTime = new Date(needToUnfurl.jobs[i].createdAt);
        let dateToPrint = `${dateTime.toLocaleDateString()} ${dateTime.toLocaleTimeString()}`;
        let total = needToUnfurl.jobs[i].total;
        let totalToPrint = total.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        });
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Job #${needToUnfurl.jobs[i].jobNumber}*\n*Client:* ${needToUnfurl.jobs[i].client.name}\n*Total:* ${totalToPrint}\n*Date:* ${dateToPrint}`,
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              emoji: true,
              text: ":globe_with_meridians: View",
            },
            url: needToUnfurl.jobs[i].jobberWebUri,
          },
        });
      }
    }
    for (let i = 0; i < needToUnfurl.invoices.length; i++) {
      if (needToUnfurl.invoices[i] !== null) {
        let dateTime = new Date(needToUnfurl.invoices[i].createdAt);
        let dateToPrint = `${dateTime.toLocaleDateString()} ${dateTime.toLocaleTimeString()}`;
        let total = needToUnfurl.invoices[i].amounts.total;
        let totalToPrint = total.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        });
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Invoice #${needToUnfurl.invoices[i].invoiceNumber}*\n*Client:* ${needToUnfurl.invoices[i].client.name}\n*Total:* ${totalToPrint}\n*Date:* ${dateToPrint}`,
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              emoji: true,
              text: ":globe_with_meridians: View",
            },
            url: needToUnfurl.invoices[i].jobberWebUri,
          },
        });
      }
    }

    // Add dividers in between elements
    blocks = interleave(blocks, {
      type: "divider",
    });

    if (blocks.length > 1) {
      await sendReplyRawMessageBlocks(
        event,
        `Found references to these Jobber items:`,
        blocks,
      );

      console.info(`Slack: Found references to Jobber item. Linked.`);
    } else {
      console.info(`Slack: No references in message. Not linked.`);
    }
  }
}

/**
 * Verifies Slack webhook signatures.
 * @param {import("express").Request & {rawBody?: string}} req
 * @param {boolean} [doYouLikeItRaw=false]
 * @returns {boolean}
 */
export function verifyWebhook(req, doYouLikeItRaw = false) {
  if (process.env.DEBUG === "TRUE") {
    return true;
  }

  // Ensure Slack's signature headers exist
  if (
    "x-slack-signature" in req.headers &&
    "x-slack-request-timestamp" in req.headers
  ) {
    // Get the signature
    let slackSignature = req.headers["x-slack-signature"];
    let body = doYouLikeItRaw ? req.rawBody : req.body;
    let timestamp = req.headers["x-slack-request-timestamp"];

    // Verify that this request was signed within the past 5 minutes
    let time = Math.floor(new Date().getTime() / 1000);
    if (Math.abs(time - timestamp) > 300) {
      return false;
    }

    let sigBaseString = "v0:" + timestamp + ":" + body;
    let mySignature =
      "v0=" +
      crypto
        .createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
        .update(sigBaseString, "utf8")
        .digest("hex");

    if (
      crypto.timingSafeEqual(
        Buffer.from(mySignature, "utf8"),
        Buffer.from(slackSignature, "utf8"),
      )
    ) {
      return true;
    }
  }

  // This is not signed properly
  return false;
}

/**
 * Opens a modal showing recent jobs for the user.
 * @param {string} trigger_id
 * @param {string} user
 * @returns {Promise<void>}
 */
async function jobsModal(trigger_id, user) {
  let jobs = await findUserJobs(user);

  let jobBlocks = [];
  if (jobs.length > 0) {
    for (let job of jobs) {
      if (jobBlocks.length + 2 <= 99) {
        jobBlocks.push({
          type: "divider",
        });
        jobBlocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `J#${job.jobNumber} ${job.jobStatus === "archived" ? ":white_check_mark:" : ":x:"}\nClient: ${job.client.name}\nTotal: $${job.total}${job.jobberWebUri ? `\n<${job.jobberWebUri}|Open in Jobber>` : ""}`,
          },
        });
      }
    }
  } else {
    jobBlocks.push({
      type: "divider",
    });
    jobBlocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No jobs found. Check that your name in Slack matches your name in Jobber",
      },
    });
  }

  await app.client.views.open({
    trigger_id: trigger_id,
    view: {
      type: "modal",
      callback_id: "open_job_modal",
      title: {
        type: "plain_text",
        text: "Jobs",
      },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Here's jobs in the past 30 days found for \`${user}\`.\n:white_check_mark: means that the job is closed\n:x: means that the job isn't closed properly`,
          },
        },
        ...jobBlocks,
      ],
    },
  });
}

/**
 * Opens a modal showing recent invoices for the user.
 * @param {string} trigger_id
 * @param {string} user
 * @returns {Promise<void>}
 */
async function invoicesModal(trigger_id, user) {
  let invoices = await findUserInvoices(user);

  let invoiceBlocks = [];
  if (invoices.length > 0) {
    for (let invoice of invoices) {
      if (invoiceBlocks.length + 2 <= 99) {
        invoiceBlocks.push({
          type: "divider",
        });
        invoiceBlocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `I#${invoice.invoiceNumber}\nClient: ${invoice.client.name}\nTotal: $${invoice.amounts.total}${invoice.jobberWebUri ? `\n<${invoice.jobberWebUri}|Open in Jobber>` : ""}`,
          },
        });
      }
    }
  } else {
    invoiceBlocks.push({
      type: "divider",
    });
    invoiceBlocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No invoices found. Check that your name in Slack matches your name in Jobber",
      },
    });
  }

  await app.client.views.open({
    trigger_id: trigger_id,
    view: {
      type: "modal",
      callback_id: "open_invoice_modal",
      title: {
        type: "plain_text",
        text: "Invoices",
      },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Here's invoices in the past 30 days found for \`${user}\``,
          },
        },
        ...invoiceBlocks,
      ],
    },
  });
}

/**
 * Handles Slack event webhooks.
 * @param {import("express").Request} req
 * @returns {Promise<void>}
 */
export async function event(req) {
  let event = req.body.event;

  // Do stuff based on the type of event
  switch (event.type) {
    // If the event is a reaction added
    case "reaction_added":
      let message = await fetchMessage(event.item.channel, event.item.ts);

      // If this was a thumbs up reaction
      if (event.reaction.includes("+1")) {
        events.emit(
          "trello-move-contact-card",
          message.text,
          process.env.TRELLO_LIST_NAME_WIP,
        );
      }

      // If this was a thumbs up reaction
      if (event.reaction.includes("check_mark")) {
        events.emit(
          "trello-move-contact-card",
          message.text,
          process.env.TRELLO_LIST_NAME_DONE,
        );
      }

      // If this was an X, thumbs down, or call_me reaction
      if (
        event.reaction === "x" ||
        event.reaction.includes("-1") ||
        event.reaction.includes("call_me")
      ) {
        events.emit(
          "trello-move-contact-card",
          message.text,
          process.env.TRELLO_LIST_NAME_NO_GO,
        );
      }
      break;
    case "message":
      switch (event.subtype) {
        // If this was a message deletion
        case "message_deleted":
          console.info(`Slack: Message deleted!`);
          break;
        // If this was a message created
        case "bot_message":
        case undefined:
          await unfurlMessage(event);
          break;
      }
      break;
    case "link_shared":
      // Although Slack's API is set up to notify us about links being shared that point to Jobber, Jobber's API
      // doesn't support searching for items via the URI of the item. This will (hopefully) be added by Jobber.
      // Ref: https://github.com/DeathCamel58/plumb-all-slack-integration/issues/3#issuecomment-1433056300
      console.warn(
        `Slack: Link was shared in message. Can't unfurl due to Jobber API lacking search functionality.`,
      );
      break;
    case "app_home_opened":
      await publishHome(event.user);

      break;
    default:
      console.info(`Slack: Slack sent an unhandled event type: ${event.type}`);
      break;
  }
}
events.on("slack-EVENT", event);

/**
 * Handles Slack interactivity payloads.
 * @param {import("express").Request} req
 * @returns {Promise<void>}
 */
async function interactivity(req) {
  let event = req.body.payload;

  // Do stuff based on the type of event
  switch (event.type) {
    // If the event is a reaction added
    case "block_actions":
      for (let action of event.actions) {
        let userResponse = await app.client.users.profile.get({
          user: event.user.id,
        });
        let user = null;
        if (userResponse.ok) {
          user = userResponse.profile.real_name;
        }

        let employeePhoneNumber =
          userResponse?.profile?.fields?.Xf03M22Q81Q8?.value;
        if (!employeePhoneNumber && userResponse?.profile?.phone) {
          employeePhoneNumber = userResponse.profile.phone;
        }

        switch (action.action_id) {
          case "get-open-jobs-0":
            console.log("Slack: User requests the get open jobs message!");

            // Get the open jobs by user
            let openJobs = await Jobber.findOpenJobBlame();

            // Now that we have the dict of open jobs by user, build the message someone can copy and paste in Slack
            let message = "";
            for (const key in openJobs) {
              let currentUserMessage = `Do these jobs need to be open @${key}? `;

              for (const job in openJobs[key]) {
                currentUserMessage += `J#${job} `;
              }

              currentUserMessage += "\n";

              message += currentUserMessage;
            }

            await app.client.views.open({
              trigger_id: event.trigger_id,
              view: {
                type: "modal",
                callback_id: "open_job_modal",
                title: {
                  type: "plain_text",
                  text: "Open Jobs",
                },
                blocks: [
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `\`\`\`\n${message}\n\`\`\``,
                    },
                  },
                ],
              },
            });

            break;
          case "get-my-jobs-0":
            console.log("Slack: User requests their jobs!");

            await jobsModal(event.trigger_id, user);

            break;
          case "get-my-invoices-0":
            console.log("Slack: User requests their invoices!");

            await invoicesModal(event.trigger_id, user);

            break;
          case "outbound-call-0":
            console.log("Slack: User wants an outbound call!");

            const customerPhoneRaw = action.value;
            const customerPhoneNumber = customerPhoneRaw;

            const slackTs =
              event?.container?.message_ts ||
              event?.message?.ts ||
              event?.container?.thread_ts ||
              null;

            if (!customerPhoneNumber) {
              await app.client.chat.postEphemeral({
                channel: event.channel?.id,
                user: event.user.id,
                text: "I couldn't start the call because the customer's phone number looked invalid or missing.",
              });
              break;
            }

            if (!employeePhoneNumber) {
              await app.client.chat.postEphemeral({
                channel: event.channel?.id,
                user: event.user.id,
                text: "I couldn't start the call because your Slack profile doesn't have a valid phone number. Add one in Slack profile settings and try again.",
              });
              break;
            }

            try {
              const sid = await callEmployeeThenCustomer(
                employeePhoneNumber,
                customerPhoneNumber,
                slackTs,
              );

              // await app.client.chat.postEphemeral({
              //   channel: event.channel?.id,
              //   user: event.user.id,
              //   text: `Placing the call now. (ref: ${sid})`,
              // });
            } catch (e) {
              Sentry.captureException(e);
              console.error("Slack: outbound call failed", e);

              await app.client.chat.postEphemeral({
                channel: event.channel?.id,
                user: event.user.id,
                text: "Sorry — the outbound call failed to start. Please try again, or contact an admin.",
              });
            }

            break;
          case "outbound-text-0":
            console.log("Slack: User wants an outbound text!");

            const outboundTextThreadTs =
              event?.container?.thread_ts ||
              event?.container?.message_ts ||
              event?.message?.thread_ts ||
              event?.message?.ts ||
              null;

            await app.client.views.open({
              trigger_id: event.trigger_id,
              view: {
                type: "modal",
                callback_id: "send_text_modal",
                title: {
                  type: "plain_text",
                  text: "Send Text",
                },
                submit: {
                  type: "plain_text",
                  text: "Send Text",
                },
                private_metadata: JSON.stringify({
                  customerPhoneNumber: action.value,
                  threadTs: outboundTextThreadTs,
                }),
                blocks: [
                  {
                    type: "input",
                    block_id: "sms_text_message_input",
                    element: {
                      type: "plain_text_input",
                      multiline: true,
                      action_id: "send_text_modal_action",
                    },
                    label: {
                      type: "plain_text",
                      text: "Message to send",
                      emoji: true,
                    },
                    optional: false,
                  },
                  {
                    type: "input",
                    block_id: "sms_text_file_input",
                    element: {
                      type: "file_input",
                      action_id: "send_text_modal_file_action",
                      filetypes: ["jpg", "jpeg", "png", "gif", "mp4", "pdf"],
                      max_files: 1,
                    },
                    label: {
                      type: "plain_text",
                      text: "Attachment (optional)",
                      emoji: true,
                    },
                    optional: true,
                  },
                ],
              },
            });

            const assignedTwilioNumber =
              await getOrAssignEmployeeNumber(employeePhoneNumber);

            await updateTwilioContact(
              action.value,
              assignedTwilioNumber.phoneNumber,
              outboundTextThreadTs,
            );

            break;
          case "outbound-text-1":
            console.log("Slack: User sent an outbound text!");

            // TODO: Send outbound text messages once A2P campaign is approved

            break;
          case "new-outbound-call-0":
            console.log("Slack: User wants an outbound call!");

            await app.client.views.open({
              trigger_id: event.trigger_id,
              view: {
                type: "modal",
                callback_id: "new_outbound_call_modal",
                title: {
                  type: "plain_text",
                  text: "Place Call",
                },
                submit: {
                  type: "plain_text",
                  text: "Call",
                },
                close: {
                  type: "plain_text",
                  text: "Cancel",
                },
                blocks: [
                  {
                    type: "input",
                    block_id: "new_outbound_call_number",
                    element: {
                      type: "plain_text_input",
                      action_id: "new_outbound_call_number_action",
                      placeholder: {
                        type: "plain_text",
                        text: "e.g., 555-123-4567 or +1 555 123 4567",
                      },
                    },
                    label: {
                      type: "plain_text",
                      text: "Phone number to call",
                      emoji: true,
                    },
                    optional: false,
                  },
                ],
              },
            });

            break;
          case "new-outbound-sms-0":
            console.log("Slack: User wants to send an outbound SMS!");

            await app.client.views.open({
              trigger_id: event.trigger_id,
              view: {
                type: "modal",
                callback_id: "new_outbound_sms_modal",
                title: {
                  type: "plain_text",
                  text: "Send a Text",
                },
                submit: {
                  type: "plain_text",
                  text: "Send",
                },
                close: {
                  type: "plain_text",
                  text: "Cancel",
                },
                blocks: [
                  {
                    type: "input",
                    block_id: "new_outbound_sms_number",
                    element: {
                      type: "plain_text_input",
                      action_id: "new_outbound_sms_number_action",
                      placeholder: {
                        type: "plain_text",
                        text: "e.g., 555-123-4567 or +1 555 123 4567",
                      },
                    },
                    label: {
                      type: "plain_text",
                      text: "Phone number to text",
                      emoji: true,
                    },
                    optional: false,
                  },
                  {
                    type: "input",
                    block_id: "new_outbound_sms_message",
                    element: {
                      type: "plain_text_input",
                      action_id: "new_outbound_sms_message_action",
                      multiline: true,
                      placeholder: {
                        type: "plain_text",
                        text: "Type your message here...",
                      },
                    },
                    label: {
                      type: "plain_text",
                      text: "Message",
                      emoji: true,
                    },
                    optional: false,
                  },
                  {
                    type: "input",
                    block_id: "new_outbound_sms_file",
                    element: {
                      type: "file_input",
                      action_id: "new_outbound_sms_file_action",
                      filetypes: ["jpg", "jpeg", "png", "gif", "mp4", "pdf"],
                      max_files: 1,
                    },
                    label: {
                      type: "plain_text",
                      text: "Attachment (optional)",
                      emoji: true,
                    },
                    optional: true,
                  },
                ],
              },
            });

            break;
          case "unassign-number-0":
            console.log(`Slack: User unassigning the number ${action.value}!`);

            const isAdmin = await isUserAdmin(event.user.id);

            if (!isAdmin) {
              break;
            }

            await unassignNumber(action.value);

            await publishHome(event.user.id);

            break;
          default:
            console.warn(
              `Slack: Slack INTERACTIVITY had unhandled action ID ${action.action_id}`,
            );
            break;
        }
      }
      break;
    case "view_submission":
      console.log("Slack: User submitted a view!");

      let userResponse = await app.client.users.profile.get({
        user: event.user.id,
      });
      let user = null;
      if (userResponse.ok) {
        user = userResponse.profile.real_name;
      }

      const employeePhoneNumber =
        userResponse?.profile?.fields?.Xf03M22Q81Q8?.value ||
        userResponse?.profile?.phone;

      switch (event.view.callback_id) {
        case "send_text_modal":
          console.log("Slack: User submitted a send text modal!");

          let privateMetadata = {};
          try {
            privateMetadata = JSON.parse(event.view.private_metadata || "{}");
          } catch (_error) {
            privateMetadata = {};
          }
          const customerPhoneNumberText =
            privateMetadata.customerPhoneNumber || event.view.private_metadata;
          const threadTs = privateMetadata.threadTs || null;
          const smsMessage =
            event.view.state.values.sms_text_message_input
              .send_text_modal_action.value;
          let smsMediaUrl = null;
          const uploadedFiles =
            event.view.state.values.sms_text_file_input
              ?.send_text_modal_file_action?.files;
          if (uploadedFiles?.length > 0) {
            const slackFile = uploadedFiles[0];
            try {
              const fileResp = await fetch(slackFile.url_private_download, {
                headers: {
                  Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
                },
              });
              const buffer = Buffer.from(await fileResp.arrayBuffer());
              const token = hostFile(buffer, slackFile.mimetype);
              smsMediaUrl = `${process.env.WEB_URL}/media/${token}`;
            } catch (e) {
              Sentry.captureException(e);
              console.error(
                "Slack: Failed to download attached file for send_text_modal",
                e,
              );
            }
          }

          try {
            await textCustomer(
              customerPhoneNumberText,
              employeePhoneNumber,
              smsMessage,
              threadTs,
              smsMediaUrl,
            );

            await sendMessageBlocks(
              [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `SMS To ${customerPhoneNumberText}\n${smsMessage}`,
                  },
                },
              ],
              "New Call Bot",
              threadTs,
              process.env.SLACK_CHANNEL,
            );
          } catch (e) {
            Sentry.captureException(e);
            console.error("Slack: outbound call failed", e);

            await app.client.chat.postEphemeral({
              channel: event.channel?.id,
              user: event.user.id,
              text: "Sorry — the outbound call failed to start. Please try again, or contact an admin.",
            });
          }

          break;
        case "new_outbound_sms_modal": {
          console.log("Slack: User submitted a new outbound SMS modal!");

          const smsNumberRaw =
            event.view.state.values.new_outbound_sms_number
              .new_outbound_sms_number_action.value;
          const smsMessageText =
            event.view.state.values.new_outbound_sms_message
              .new_outbound_sms_message_action.value;

          // Download attached file from Slack (if any) and host it temporarily for Twilio
          let smsMediaUrl = null;
          const uploadedFiles =
            event.view.state.values.new_outbound_sms_file
              ?.new_outbound_sms_file_action?.files;
          if (uploadedFiles?.length > 0) {
            const slackFile = uploadedFiles[0];
            try {
              const fileResp = await fetch(slackFile.url_private_download, {
                headers: {
                  Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
                },
              });
              const buffer = Buffer.from(await fileResp.arrayBuffer());
              const token = hostFile(buffer, slackFile.mimetype);
              smsMediaUrl = `${process.env.WEB_URL}/media/${token}`;
            } catch (e) {
              Sentry.captureException(e);
              console.error(
                "Slack: Failed to download attached file for SMS",
                e,
              );
            }
          }

          const smsResult = await startOutboundSmsFlow({
            userId: event.user.id,
            employeePhoneNumber,
            rawCustomerNumber: smsNumberRaw,
            smsMessage: smsMessageText,
            mediaUrl: smsMediaUrl,
          });

          await app.client.views.open({
            trigger_id: event.trigger_id,
            view: {
              type: "modal",
              callback_id: smsResult.ok
                ? "new_outbound_sms_success_modal"
                : "new_outbound_sms_failure_modal",
              title: {
                type: "plain_text",
                text: smsResult.ok ? "Text Sent" : "Send Text Failed",
              },
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: smsResult.userMessage,
                  },
                },
              ],
            },
          });

          break;
        }
        case "new_outbound_call_modal":
          console.log("Slack: User submitted a new outbound call modal!");

          const newCallNumberRaw =
            event.view.state.values.new_outbound_call_number
              .new_outbound_call_number_action.value;

          const result = await startOutboundCallFlow({
            userId: event.user.id,
            employeePhoneNumber,
            rawCustomerNumber: newCallNumberRaw,
          });

          await app.client.views.open({
            trigger_id: event.trigger_id,
            view: {
              type: "modal",
              callback_id: result.ok
                ? "new_outbound_call_success_modal"
                : "new_outbound_call_failure_modal",
              title: {
                type: "plain_text",
                text: result.ok
                  ? "Outbound Call Success"
                  : "Outbound Call Failure",
              },
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: result.userMessage,
                  },
                },
              ],
            },
          });

          break;
        default:
          console.warn(
            `Slack: Slack INTERACTIVITY had unhandled view callback ID ${event.view.callback_id}`,
          );
          break;
      }

      break;
    default:
      console.info(
        `Slack: Slack sent an unhandled INTERACTIVITY type: ${event.type}`,
      );
      break;
  }
}
events.on("slack-INTERACTIVITY", interactivity);

/**
 * Handles Slack slash command payloads.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @returns {Promise<void>}
 */
async function command(req, res) {
  const commandName = req.body?.command;
  const rawText = (req.body?.text || "").trim();
  const userId = req.body?.user_id;

  if (!userId) {
    console.warn("Slack: COMMAND missing user_id");
    return;
  }

  let userResponse;
  try {
    userResponse = await app.client.users.profile.get({
      user: userId,
    });
  } catch (error) {
    Sentry.captureException(error);
    console.error("Slack: Failed to fetch user profile for command", error);
  }

  switch (commandName) {
    case "/dial":
      const employeePhoneNumber =
        userResponse?.profile?.fields?.Xf03M22Q81Q8?.value ||
        userResponse?.profile?.phone;

      const result = await startOutboundCallFlow({
        userId,
        employeePhoneNumber,
        rawCustomerNumber: rawText,
      });

      if (!result.ok) {
        console.warn(
          `Slack: ${result.userMessage}\nUsage: /dial <phone_number>`,
        );
        res.send(`${result.userMessage}\nUsage: /dial <phone_number>`);
        break;
      }

      res.send("Calling you and connecting to customer...");

      break;
    case "/sms": {
      const spaceIndex = rawText.indexOf(" ");
      if (spaceIndex === -1) {
        res.send("Usage: /sms <phone_number> <message>");
        break;
      }

      const smsTargetRaw = rawText.slice(0, spaceIndex).trim();
      const smsBody = rawText.slice(spaceIndex + 1).trim();

      if (!smsBody) {
        res.send("Usage: /sms <phone_number> <message>");
        break;
      }

      const smsEmployeePhone =
        userResponse?.profile?.fields?.Xf03M22Q81Q8?.value ||
        userResponse?.profile?.phone;

      const smsResult = await startOutboundSmsFlow({
        userId,
        employeePhoneNumber: smsEmployeePhone,
        rawCustomerNumber: smsTargetRaw,
        smsMessage: smsBody,
      });

      if (!smsResult.ok) {
        console.warn(
          `Slack: ${smsResult.userMessage}\nUsage: /sms <phone_number> <message>`,
        );
      }

      res.send(smsResult.userMessage);

      break;
    }
    default:
      console.warn(`Slack: Unsupported command: ${commandName}`);
      res.send(`Unsupported command ${commandName}. Try /dial <phone_number>.`);
      break;
  }
}
events.on("slack-COMMAND", command);
