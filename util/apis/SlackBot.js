const { App } = require('@slack/bolt');
let Trello = require('./Trello');
const crypto = require('crypto');

module.exports = {
    sendMessage,
    sendRawMessage,
    verifyWebhook,
    event
}

const slackCallChannelName = (process.env.SLACK_CHANNEL || "calls");

const app = new App({
    signingSecret: process.env.SLACK_SIGNING_SECRET || "",
    token: process.env.SLACK_TOKEN || ""
});

// Log into Slack and such
(async () => {
    // Start your app
    await app.start(3000);

    console.log('Logged into Slack!');
})();

/**
 * Takes message, and sends it to slack with given username
 * @param message The message to send
 * @param username Username to send the message as
 * @returns {Promise<void>} Promise that resolves after message is sent
 */
async function sendMessage(message, username) {
    console.log(message)

    try {
        const result = await app.client.chat.postMessage({
            channel: slackCallChannelName,
            text: message,
            unfurl_links: false,
            username: username,
            icon_url: "https://plumb-all.com/wp-content/uploads/2018/08/cropped-icon.png"
        });

        console.log('    Sent Message to Slack!');
    }
    catch (error) {
        console.error(error);
    }
}

async function sendRawMessage(rawMessage) {
    try {
        const result = await app.client.chat.postMessage({
            channel: slackCallChannelName,
            text: rawMessage,
            unfurl_links: false,
            username: "Call Bot Jobber Authorization",
            icon_url: "https://plumb-all.com/wp-content/uploads/2018/08/cropped-icon.png"
        });

        console.log('Sent Jobber authorization request to Slack!');
    }
    catch (error) {
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
            limit: 1
        });

        // There should only be one result (stored in the zeroth index)
        let message = result.messages[0];

        // Return the message
        return message;
    }
    catch (error) {
        console.error(error);
    }
}

/**
 * Takes in a Slack webhook request, and checks if it's authentic
 * @param req The request
 * @returns {boolean} Is the webhook authentic?
 */
function verifyWebhook(req) {
    // Ensure Slack's signature headers exist
    if ("x-slack-signature" in req.headers && "x-slack-request-timestamp" in req.headers) {
        // Get the signature
        let slackSignature = req.headers['x-slack-signature'];
        let body = req.body;
        let timestamp = req.headers['x-slack-request-timestamp'];

        // Verify that this request was signed within the past 5 minutes
        let time = Math.floor(new Date().getTime()/1000);
        if (Math.abs(time - timestamp) > 300) {
            return false;
        }

        let sigBaseString = 'v0:' + timestamp + ':' + body;
        let mySignature = 'v0=' + crypto
            .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
            .update(sigBaseString, 'utf8')
            .digest('hex');

        if (crypto.timingSafeEqual(Buffer.from(mySignature, 'utf8'), Buffer.from(slackSignature, 'utf8'))) {
            return true;
        }
    }

    // This is not signed properly
    return false;
}

/**
 * Takes in a Slack webhook for an event, and processes it
 * @param req
 * @returns {Promise<void>}
 */
async function event(req) {
    let event = req.body.event;

    // If the event is a reaction added
    if (event.type === "reaction_added") {
        let message = await fetchMessage(event.item.channel, event.item.ts);

        // If this was a thumbs up reaction
        if (event.reaction.includes("+1")) {
            await Trello.moveContactCard(message.text, process.env.TRELLO_LIST_NAME_WIP);
        }

        // If this was a thumbs up reaction
        if (event.reaction.includes("check_mark")) {
            await Trello.moveContactCard(message.text, process.env.TRELLO_LIST_NAME_DONE);
        }

        // If this was an X, thumbs down, or call_me reaction
        if (event.reaction === "x" || event.reaction.includes("-1") || event.reaction.includes("call_me")) {
            await Trello.moveContactCard(message.text, process.env.TRELLO_LIST_NAME_NO_GO);
        }
    }
}
