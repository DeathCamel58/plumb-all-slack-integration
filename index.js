require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
let slack = require('./util/slackBot.js');
let messageConstructor = require('./util/messageConstructor.js');
let emailClient = require('./util/emailClient.js');
const express = require( 'express' );
const app = express();

const _ = require('lodash');

/**
 * Creates a message to send in slack, and sends it off if it is a contact email
 * @param item Raw email to process
 * @param mail email
 * @returns {Promise<void>} Promise that resolves after message sent, or ignored
 */
async function handleMessage(mail) {
    let [message, fromWhere] = messageConstructor.createMessage(mail);
    if (fromWhere != null) {
        await slack.sendMessage(message, fromWhere + " Contact");
        if (fromWhere !== "Google Ads"){
            await emailClient.moveMarkEmail(mail, fromWhere);
        }
    }
}

/**
 * Checks if the email is a concatenation of all the previous day's emails.
 * If not, it passes email to function that processes this email for sending
 * If it is, does nothing
 * @param email Single email to process
 * @returns {Promise<void>} Promise that resolves after completion
 */
async function handleMessages(email) {
    let all = _.find(email.parts, { "which": "" })

    if (["notification@getjobber.com", "submissions@formsubmit.co", "operator@youransweringservices.com", "answerphoneoperator@dixie-net.com"].includes(email.from.emailAddress.address)) {
        if (!email.body.content.includes("Email of All Messages to 3646 PLUMB-ALL")) {
            await handleMessage(email);
        } else {
            console.log("Moving email (it's a concatenation of all previous day's emails)...");
            await emailClient.moveMarkEmail(email, "Call")
        }
    }
}

/**
 * Does nothing and makes program wait for a time
 * @param ms The number of milliseconds to wait before resolving
 * @returns {Promise<unknown>} Promise that resolves after `n` ms
 */
async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    })
}

/**
 * Checks for new email, and processes them
 * @returns {Promise<void>} Promise that resolves after all emails are processed and disconnected from email
 */
async function runSingle() {
    let messages = await emailClient.getMail();
    await Promise.all(messages.map(async (item) => {
        await handleMessages(item);
    }))
}

/**
 * Starts the event loop that regularly re-runs the processing function
 * @returns {Promise<void>} Promise that resolves when event loop stops (should be never)
 */
async function startProcessing() {
    while (true) {
        try {
            await runSingle();
        } catch (err) {
            console.log("Error thrown!");
            console.log(err);
            console.log("Waiting a bit, and restarting event loop.")
        }
        await sleep(process.env.emailCheckInterval || 30000)
    }
}

startProcessing()


// Webhook Server
app.use( express.json() );

async function processMessage(webhookBody) {
    let googleKey = process.env.googleKey || "testkey";
    if (webhookBody.google_key === googleKey) {
        await handleMessage(null, null, webhookBody, null)
    } else {
        console.log('Incoming webhook was not authenticated! Incoming follows:');
        console.log(webhookBody)
    }
}

app.post( '/googleAdsForm', ( req, res ) => {
    processMessage(req.body);

    res.sendStatus( 200 );
} );

app.listen( 47092, "0.0.0.0", () => console.log( 'Node.js server started on port 9000.' ) );
