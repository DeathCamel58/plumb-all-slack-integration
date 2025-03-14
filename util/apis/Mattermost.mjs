import mattermost from "@mattermost/client";
import Jobber from "./Jobber.js";
import { interleave } from "../DataUtilities.js";
import events from "../events.js";

// module.exports = {
//     verifyWebhook,
//     event
// };

const client = new mattermost.Client4();

// Configure the client
client.setUrl(process.env.MATTERMOST_URL);
const connectionUrl = client.getWebSocketUrl();
const authToken = process.env.MATTERMOST_TOKEN;
client.setToken(authToken);

// Handle Node.js not defining globalThis.WebSocket
if (!globalThis.WebSocket) {
  const { WebSocket } = await import("ws");
  globalThis.WebSocket = WebSocket;
}

const wsClient = new mattermost.WebSocketClient();

// Log connection state changes
wsClient.addFirstConnectListener(() => {
  console.log("WebSocket connected successfully");
});

wsClient.addCloseListener((event) => {
  console.log(`WebSocket disconnected. Event:\n${JSON.stringify(event)}`);
});

wsClient.addMissedMessageListener(() => {
  console.log("Using missed message listener to work around https://github.com/mattermost/mattermost/issues/30388")
})

// Handle websocket errors and attempt to reconnect

function wsConnect() {
  wsClient.initialize(connectionUrl, authToken);
}

// wsClient.addCloseListener()
wsClient.addErrorListener((error) => {
  console.error("WebSocket encountered an error:", error);
});

// Connect via the websocket client
wsConnect();

const mattermostCallChannelName = process.env.MATTERMOST_CHANNEL || "calls";

/**
 * Takes message, and sends it to Mattermost with given username
 * @param message The message to send
 * @param username Username to send the message as
 * @param channelName The channel to send the message to
 * @returns {Promise<void>} Promise that resolves after message is sent
 */
async function sendMessage(
  message,
  username,
  channelName = mattermostCallChannelName,
) {
  console.info(message);

  // TODO: Check if we can send in Mattermost with another username

  try {
    const teams = await client.getMyTeams();
    const channels = await client.getChannels(teams[0].id);
    let channelId = null;
    for (const channel of channels) {
      if (channel.name === channelName) {
        channelId = channel.id;
      }
    }
    if (!channelId) {
      console.error(
        `Couldn't determine channel ID for ${channelName}. Found channels are:\n${JSON.stringify(channels)}`,
      );
    }

    await client.createPost({
      channel_id: channelId,
      message: message,
    });

    console.info("    Sent Message to Mattermost!");
  } catch (error) {
    console.error(error);
  }
}
events.emitter.on("mattermost-send-message", sendMessage);

async function sendReplyRawMessageBlocks(event, markdown) {
  try {
    const originalPostData = JSON.parse(event.data.post);
    await client.createPost({
      channel_id: originalPostData.channel_id,
      message: markdown,
      root_id: originalPostData.id,
    });

    console.info("Linked references in Mattermost message!");
  } catch (error) {
    console.error(error);
  }
}

/**
 * Find referenced items from Jobber, and reply in thread to quote, job, or invoice references.
 * @param event the webhook event to check for references
 * @returns {Promise<void>}
 */
async function findMessageReference(event) {
  // The found Quotes, Jobs, and Invoices get stored here
  let needToUnfurl = {
    quotes: [],
    jobs: [],
    invoices: [],
  };

  // Parse the post data
  const parsed = JSON.parse(event.data.post);

  // Don't find references in our own message
  if (parsed.message.startsWith("Found these Jobber items referenced:")) {
    return;
  }

  // Check for references in multiple formats, and add them to `needToUnfurl`
  // Remove all user references first, as user references can make the regex return a false positive
  let tmp = parsed.message;
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
            `Didn't push unfurl reference into array. String didn't start with [QqJjIi]: ${tmp[i]}`,
          );
          break;
      }
    }
  }

  let data = [];

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
        data.push({
          dateTime: `${dateTime.toLocaleDateString()} ${dateTime.toLocaleTimeString()}`,
          total: needToUnfurl.quotes[i].amounts.total,
          totalToPrint: needToUnfurl.quotes[i].amounts.total.toLocaleString(
            "en-US",
            { style: "currency", currency: "USD" },
          ),
          typeNumber: `Quote #${needToUnfurl.quotes[i].quoteNumber}`,
          link: needToUnfurl.quotes[i].jobberWebUri,
          name: needToUnfurl.quotes[i].client.name,
        });
      }
    }
    for (let i = 0; i < needToUnfurl.jobs.length; i++) {
      if (needToUnfurl.jobs[i] !== null) {
        let dateTime = new Date(needToUnfurl.jobs[i].createdAt);
        data.push({
          dateTime: `${dateTime.toLocaleDateString()} ${dateTime.toLocaleTimeString()}`,
          total: needToUnfurl.jobs[i].amounts.total,
          totalToPrint: needToUnfurl.jobs[i].amounts.total.toLocaleString(
            "en-US",
            { style: "currency", currency: "USD" },
          ),
          typeNumber: `Quote #${needToUnfurl.jobs[i].jobNumber}`,
          link: needToUnfurl.jobs[i].jobberWebUri,
          name: needToUnfurl.jobs[i].client.name,
        });
      }
    }
    for (let i = 0; i < needToUnfurl.invoices.length; i++) {
      if (needToUnfurl.invoices[i] !== null) {
        let dateTime = new Date(needToUnfurl.invoices[i].createdAt);
        data.push({
          dateTime: `${dateTime.toLocaleDateString()} ${dateTime.toLocaleTimeString()}`,
          total: needToUnfurl.invoices[i].amounts.total,
          totalToPrint: needToUnfurl.invoices[i].amounts.total.toLocaleString(
            "en-US",
            { style: "currency", currency: "USD" },
          ),
          typeNumber: `Quote #${needToUnfurl.invoices[i].invoiceNumber}`,
          link: needToUnfurl.invoices[i].jobberWebUri,
          name: needToUnfurl.invoices[i].client.name,
        });
      }
    }

    if (data.length > 0) {
      // The message to send in Mattermost
      let message = "Found these Jobber items referenced:";

      for (const item of data) {
        message += `\n\n---\n[**${item.typeNumber}**](${item.link})\n- Client: ${item.name}\n- Total: \`${item.total}\`\n- Date: ${item.dateTime}`;
      }

      await sendReplyRawMessageBlocks(event, message);

      console.info(`Found references to Jobber item in Mattermost. Linked.`);
    } else {
      console.info(`No references in Mattermost message. Not linked.`);
    }
  }
}

wsClient.addMessageListener((msg) => {
  if (process.env.DEBUG === "TRUE") {
    console.log(
      `Message received from WebSocket: ${msg.event}\n${JSON.stringify(msg.data)}`,
    );
  }
  if (msg.event === "posted") {
    console.log("New post received", JSON.parse(msg.data.post));
    findMessageReference(msg).then((output) => console.log("message unfurled"));
  }
});
