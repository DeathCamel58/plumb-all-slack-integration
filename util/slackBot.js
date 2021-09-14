const { App } = require('@slack/bolt');

module.exports = {
    sendMessage
}

const slackCallChannelName = (process.env.slackChannel || "calls");

const app = new App({
    signingSecret: process.env.slackSigningSecret || "",
    token: process.env.slackToken || ""
});

// Log into Slack and such
(async () => {
    // Start your app
    await app.start(3000);

    console.log('Logged into Slack!');
})();

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