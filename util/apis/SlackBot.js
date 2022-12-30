const { App } = require('@slack/bolt');

module.exports = {
    sendMessage,
    sendRawMessage
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