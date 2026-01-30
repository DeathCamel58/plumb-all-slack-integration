import Slack from "@slack/bolt";
import * as crypto from "crypto";
import * as Jobber from "./Jobber.js";
import { interleave, toE164 } from "../DataUtilities.js";
import events from "../events.js";
import * as Sentry from "@sentry/node";
import { findUserInvoices, findUserJobs } from "./Jobber.js";
import {
  callEmployeeThenCustomer,
  getOrAssignEmployeeNumber,
  returnAssignedPhoneNumbers,
  textCustomer,
  unassignNumber,
  updateTwilioContact,
  updateTwilioContactTs,
} from "./Twilio.js";

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
 * Accepts a channel ID (C..., G...) or a channel name ("calls" or "#calls") and returns an ID.
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

        // Standard Slack profile phone field (if populated)
        const profilePhone = normalize(profile?.fields?.Xf03M22Q81Q8?.value);

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

async function publishHome(user_id) {
  const assignedNumbers = await returnAssignedPhoneNumbers();

  const assignedNumbersRows = [];

  for (const number of assignedNumbers) {
    assignedNumbersRows.push({
      type: "divider",
    });

    let assignedEmployee = "Couldn't Find User";
    if (
      number.assignedEmployee === "" &&
      number.assignedEmployeeNumber === ""
    ) {
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
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Assigned Phone Numbers*",
      },
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
 * Takes message, and sends it to slack with given username
 * @param message The message to send
 * @param username Username to send the message as
 * @param channelName The channel to send the message to
 * @returns {Promise<WebAPICallResult & {channel?: string; deprecated_argument?: string; error?: string; errors?: string[]; message?: ChatPostMessageResponseMessage; needed?: string; ok?: boolean; provided?: string; response_metadata?: ResponseMetadata; ts?: string}>} Promise that resolves after message is sent
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
 * Takes message, and sends it to slack with given username
 * @param blocks The message to send
 * @param username Username to send the message as
 * @param threadTs The thread to send the message to
 * @param channelName The channel to send the message to
 * @returns {Promise<WebAPICallResult & {channel?: string; deprecated_argument?: string; error?: string; errors?: string[]; message?: ChatPostMessageResponseMessage; needed?: string; ok?: boolean; provided?: string; response_metadata?: ResponseMetadata; ts?: string}>} Promise that resolves after message is sent
 */
async function sendMessageBlocks(
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

async function uploadFile(
  fileBuffer,
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
      filename: `call-recording-${Date.now()}.mp3`,
      title: "Call recording",
      file: fileBuffer,
      initial_comment: "Call Recorded",
    });

    console.info("Slack: Uploaded file to Slack!");
  } catch (error) {
    Sentry.captureException(error);
    console.error(error);
  }
}
events.on("slackbot-upload-file", uploadFile);

/**
 * Takes message, and sends it to slack with given username
 * @param contact The contact to send
 * @param username Username to send the message as
 * @param channelName The channel to send the message to
 * @returns {Promise<void>} Promise that resolves after message is sent
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

    const result = await app.client.chat.postMessage({
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

async function sendReplyRawMessageBlocks(event, rawMessage, blocks) {
  try {
    const result = await app.client.chat.postMessage({
      // Needed to reply in thread
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
 * Gets a message from Slack
 * @param id The ID of the channel to search
 * @param ts The message ID
 * @returns {Promise<Message>}
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
 * Unfurl's a URL (kind of), and replies in thread to quote, job, or invoice references.
 * @param event the webhook event to check for references
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

  // Check for references in multiple formats, and add them to `needToUnfurl`
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
 * Takes in a Slack webhook request, and checks if it's authentic
 * @param req The request
 * @param doYouLikeItRaw Should we validate signature using the raw body?
 * @returns {boolean} Is the webhook authentic?
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
            text: `J#${job.jobNumber} ${job.jobStatus === "archived" ? ":white_check_mark:" : ":x:"}\nClient: ${job.client.name}\nTotal: $${job.total}`,
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              text: "Open",
              emoji: true,
            },
            value: "job_link",
            url: job.jobberWebUri,
            action_id: "button-action",
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
        text: "Open Jobs Message",
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
            text: `I#${invoice.invoiceNumber}\nClient: ${invoice.client.name}\nTotal: $${invoice.amounts.total}`,
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              text: "Open",
              emoji: true,
            },
            value: "invoice_link",
            url: invoice.jobberWebUri,
            action_id: "button-action",
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
      callback_id: "open_job_modal",
      title: {
        type: "plain_text",
        text: "Open Jobs Message",
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
 * Takes in a Slack webhook for an event, and processes it
 * @param req
 * @returns {Promise<void>}
 */
export async function event(req) {
  let event = req.body.event;

  // Do stuff based on type of event
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
 * Takes in a Slack webhook for an INTERACTIVITY event, and processes it
 * @param req
 * @returns {Promise<void>}
 */
async function interactivity(req) {
  let event = req.body.payload;

  // Do stuff based on type of event
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

        const employeePhoneNumber =
          userResponse?.profile?.fields?.Xf03M22Q81Q8?.value;

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
                  text: "Open Jobs Message",
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
                private_metadata: action.value,
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
                ],
              },
            });

            const assignedTwilioNumber =
              await getOrAssignEmployeeNumber(employeePhoneNumber);

            await updateTwilioContact(
              action.value,
              assignedTwilioNumber.phoneNumber,
              event.message.ts,
            );

            break;
          case "outbound-text-1":
            console.log("Slack: User sent an outbound text!");

            // TODO: Send outbound text messages once A2P campaign is approved

            break;
          case "unassign-number-0":
            console.log(`Slack: User unassigning the number ${action.value}!`);

            // Check if the user is an admin of the slack workspace
            const userInfo = await app.client.users.info({
              user: event.user.id,
            });

            const isAdmin =
              userInfo?.user?.is_admin || userInfo?.user?.is_owner || false;

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
        userResponse?.profile?.fields?.Xf03M22Q81Q8?.value;

      switch (event.view.callback_id) {
        case "send_text_modal":
          console.log("Slack: User submitted a send text modal!");

          const customerPhoneNumber = event.view.private_metadata;
          const smsMessage =
            event.view.state.values.sms_text_message_input
              .send_text_modal_action.value;

          try {
            const sid = await textCustomer(
              customerPhoneNumber,
              employeePhoneNumber,
              smsMessage,
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
