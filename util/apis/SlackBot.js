const {App} = require('@slack/bolt');
const crypto = require('crypto');
const Jobber = require("./Jobber");
const {interleave} = require("../DataUtilities");
const events = require('../events');

module.exports = {
    verifyWebhook,
    event
};

const slackCallChannelName = (process.env.SLACK_CHANNEL || "calls");

const app = new App({
    signingSecret: process.env.SLACK_SIGNING_SECRET || "",
    token: process.env.SLACK_TOKEN || ""
});

// Log into Slack and such
(async () => {
    // Start your app
    await app.start(3000);

    console.info('Logged into Slack!');
})();

/**
 * Takes message, and sends it to slack with given username
 * @param message The message to send
 * @param username Username to send the message as
 * @returns {Promise<void>} Promise that resolves after message is sent
 */
async function sendMessage(message, username) {
    console.info(message);

    try {
        const result = await app.client.chat.postMessage({
            channel: slackCallChannelName,
            text: message,
            unfurl_links: false,
            username: username,
            icon_url: "https://plumb-all.com/wp-content/uploads/2018/08/cropped-icon.png"
        });

        console.info('    Sent Message to Slack!');
    } catch (error) {
        console.error(error);
    }
}
events.emitter.on('slackbot-send-message', sendMessage);

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
            icon_url: "https://plumb-all.com/wp-content/uploads/2018/08/cropped-icon.png"
        });

        console.info('Linked references in Slack message!');
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
        // Return the message
        return result.messages[0];
    } catch (error) {
        console.error(error);
    }
}

/**
 * Unfurl's a URL (kind of), and replies in thread to quote, job, or invoice references.
 * @param event the webhook event to check for references
 * @returns {Promise<void>}
 */
async function unfurlMessage(event) {
    console.info(`Message created!\n\t${event.user}\n\t${event.text}`);

    // The found Quotes, Jobs, and Invoices get stored here
    let needToUnfurl = {
        quotes: [],
        jobs: [],
        invoices: []
    };

    // The blocks to render in the message in Slack
    let blocks = [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: "Found these Jobber items referenced:"
            }
        }
    ];

    // Check for references in multiple formats, and add them to `needToUnfurl`
    // - Q[number], J[number], I[number]
    // - Q#[number], J#[number], I#[number]
    // - Quote [number], Job [number], Invoice [number]
    // - Quote #[number], Job #[number], Invoice #[number]
    let tmp = event.text.match(/(QUOTE|JOB|INVOICE|Q|J|I)+ *#* *(\d+)/gi);
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
                    console.warn(`Didn't push unfurl reference into array. String didn't start with [QqJjIi]: ${tmp[i]}`);
                    break;
            }
        }
    }

    if (!(needToUnfurl.quotes.length === 0 && needToUnfurl.jobs.length === 0 && needToUnfurl.invoices.length === 0)) {
        // Unfurl found references
        for (let i = 0; i < needToUnfurl.quotes.length; i++) {
            if (needToUnfurl.quotes[i] !== null) {
                let dateTime = new Date(needToUnfurl.quotes[i].createdAt);
                let dateToPrint = `${dateTime.toLocaleDateString()} ${dateTime.toLocaleTimeString()}`;
                let total = needToUnfurl.quotes[i].amounts.total;
                let totalToPrint = total.toLocaleString('en-US', {style: 'currency', currency: 'USD'});
                blocks.push({
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Quote #${needToUnfurl.quotes[i].quoteNumber}*\n*Client:* ${needToUnfurl.quotes[i].client.name}\n*Total:* ${totalToPrint}\n*Date:* ${dateToPrint}`
                    },
                    accessory: {
                        type: "button",
                        text: {
                            type: "plain_text",
                            emoji: true,
                            text: ":globe_with_meridians: View"
                        },
                        url: needToUnfurl.quotes[i].jobberWebUri
                    }
                });
            }
        }
        for (let i = 0; i < needToUnfurl.jobs.length; i++) {
            if (needToUnfurl.jobs[i] !== null) {
                let dateTime = new Date(needToUnfurl.jobs[i].createdAt);
                let dateToPrint = `${dateTime.toLocaleDateString()} ${dateTime.toLocaleTimeString()}`;
                let total = needToUnfurl.jobs[i].total;
                let totalToPrint = total.toLocaleString('en-US', {style: 'currency', currency: 'USD'});
                blocks.push({
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Job #${needToUnfurl.jobs[i].jobNumber}*\n*Client:* ${needToUnfurl.jobs[i].client.name}\n*Total:* ${totalToPrint}\n*Date:* ${dateToPrint}`
                    },
                    accessory: {
                        type: "button",
                        text: {
                            type: "plain_text",
                            emoji: true,
                            text: ":globe_with_meridians: View"
                        },
                        url: needToUnfurl.jobs[i].jobberWebUri
                    }
                });
            }
        }
        for (let i = 0; i < needToUnfurl.invoices.length; i++) {
            if (needToUnfurl.invoices[i] !== null) {
                let dateTime = new Date(needToUnfurl.invoices[i].createdAt);
                let dateToPrint = `${dateTime.toLocaleDateString()} ${dateTime.toLocaleTimeString()}`;
                let total = needToUnfurl.invoices[i].amounts.total;
                let totalToPrint = total.toLocaleString('en-US', {style: 'currency', currency: 'USD'});
                blocks.push({
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Invoice #${needToUnfurl.invoices[i].invoiceNumber}*\n*Client:* ${needToUnfurl.invoices[i].client.name}\n*Total:* ${totalToPrint}\n*Date:* ${dateToPrint}`
                    },
                    accessory: {
                        type: "button",
                        text: {
                            type: "plain_text",
                            emoji: true,
                            text: ":globe_with_meridians: View"
                        },
                        url: needToUnfurl.invoices[i].jobberWebUri
                    }
                });
            }
        }

        // Add dividers in between elements
        blocks = interleave(blocks, {
            type: "divider"
        });

        if (blocks.length > 1) {
            await sendReplyRawMessageBlocks(event, `Found references to these Jobber items:`, blocks);

            console.info(`Found references to Jobber item in Slack. Linked.`);
        } else {
            console.info(`No references in Slack message. Not linked.`);
        }
    }

}

/**
 * Takes in a Slack webhook request, and checks if it's authentic
 * @param req The request
 * @param doYouLikeItRaw Should we validate signature using the raw body?
 * @returns {boolean} Is the webhook authentic?
 */
function verifyWebhook(req, doYouLikeItRaw = false) {
    if (process.env.DEBUG === "TRUE") {
        return true;
    }

    // Ensure Slack's signature headers exist
    if ("x-slack-signature" in req.headers && "x-slack-request-timestamp" in req.headers) {
        // Get the signature
        let slackSignature = req.headers['x-slack-signature'];
        let body = doYouLikeItRaw ? req.rawBody : req.body;
        let timestamp = req.headers['x-slack-request-timestamp'];

        // Verify that this request was signed within the past 5 minutes
        let time = Math.floor(new Date().getTime() / 1000);
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

    // Do stuff based on type of event
    switch (event.type) {
        // If the event is a reaction added
        case "reaction_added":
            let message = await fetchMessage(event.item.channel, event.item.ts);

            // If this was a thumbs up reaction
            if (event.reaction.includes("+1")) {
                events.emitter.emit('trello-move-contact-card', message.text, process.env.TRELLO_LIST_NAME_WIP);
            }

            // If this was a thumbs up reaction
            if (event.reaction.includes("check_mark")) {
                events.emitter.emit('trello-move-contact-card', message.text, process.env.TRELLO_LIST_NAME_DONE);
            }

            // If this was an X, thumbs down, or call_me reaction
            if (event.reaction === "x" || event.reaction.includes("-1") || event.reaction.includes("call_me")) {
                events.emitter.emit('trello-move-contact-card', message.text, process.env.TRELLO_LIST_NAME_NO_GO);
            }
            break;
        case "message":
            switch (event.subtype) {
                // If this was a message deletion
                case "message_deleted":
                    console.info(`Message deleted!`);
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
            console.warn(`Link was shared in message. Can't unfurl due to Jobber API lacking search functionality.`);
            break;
        case "app_home_opened":
            const homeBlocks = [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "*Welcome!*\nThis is the home for Plumb-All's Slack Integration."
                    }
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "Get open jobs as message",
                                "emoji": true
                            },
                            "value": "get_open_jobs",
                            "action_id": "get-open-jobs-0"
                        }
                    ]
                }
            ];

            await app.client.views.publish({
                user_id: event.user,
                view: {
                    type: 'home',
                    title: {
                        type: 'plain_text',
                        text: 'Home'
                    },
                    blocks: homeBlocks
                }
            })

            break;
        default:
            console.info(`Slack sent an unhandled event type: ${event.type}`);
            break;
    }
}
events.emitter.on('slack-EVENT', event);

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
                switch (action.action_id) {
                    case 'get-open-jobs-0':
                        console.log('User requests the get open jobs message!');

                        // Get the open jobs by user
                        let openJobs = await Jobber.findOpenJobBlame();

                        // Now that we have the dict of open jobs by user, build the message someone can copy and paste in Slack
                        let message = '';
                        for (const key in openJobs) {
                            let currentUserMessage = `Do these jobs need to be open @${key}? `;

                            for (const job in openJobs[key]) {
                                currentUserMessage += `J#${job} `;
                            }

                            currentUserMessage += '\n';

                            message += currentUserMessage;
                        }

                        await app.client.views.open({
                            trigger_id: event.trigger_id,
                            view: {
                                type: 'modal',
                                callback_id: 'open_job_modal',
                                title: {
                                    type: 'plain_text',
                                    text: 'Open Jobs Message'
                                },
                                blocks: [
                                    {
                                        "type": "section",
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": `\`\`\`\n${message}\n\`\`\``
                                        }
                                    }
                                ]
                            }
                        });

                        break;
                    default:
                        console.warn(`Slack INTERACTIVITY had unhandled action ID ${action.action_id}`);
                        break;
                }
            }
            break;
        default:
            console.info(`Slack sent an unhandled INTERACTIVITY type: ${event.type}`);
            break;
    }
}
events.emitter.on('slack-INTERACTIVITY', interactivity);
