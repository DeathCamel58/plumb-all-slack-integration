require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
let slack = require('./util/slackBot.js');
let messageConstructor = require('./util/messageConstructor.js');
let emailClient = require('./util/emailClient.js')

const simpleParser = require('mailparser').simpleParser;
const _ = require('lodash');

/**
 * Creates a message to send in slack, and sends it off if it is a contact email
 * @param connection Email client connection
 * @param item Raw email to process
 * @param mail simpleParser parsed email
 * @param id ID of the email being processed
 * @returns {Promise<void>} Promise that resolves after message sent, or ignored
 */
async function handleMessage(connection, item, mail, id) {
    let [message, fromWhere] = messageConstructor.createMessage(mail);
    if (fromWhere != null) {
        await slack.sendMessage(message, fromWhere + " Contact");
        await emailClient.moveAndMarkEmail(connection, id, fromWhere)
    }
}

/**
 * Checks if the email is a concatenation of all the previous day's emails.
 * If not, it passes email to function that processes this email for sending
 * If it is, does nothing
 * @param connection Email client connection
 * @param email Single email to process
 * @returns {Promise<void>} Promise that resolves after completion
 */
async function handleMessages(connection, email) {
    let all = _.find(email.parts, { "which": "" })
    let id = email.attributes.uid;
    let idHeader = "Imap-Id: "+id+"\r\n";

    let mail = await simpleParser(idHeader+all.body);
    if (mail.text) {
        if (!mail.text.includes("Email of All Messages to 3646 PLUMB-ALL")) {
            await handleMessage(connection, email, mail, id);
        } else {
            console.log("Ignoring email (it's a concatenation of all previous day's emails)...");
        }
    } else {
        console.log("No text in body of email")
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
    let connection = await emailClient.connect();
    let connect = await emailClient.openInbox(connection);
    let messages = await emailClient.getNewMail(connection, 90 * 24 * 3600 * 1000)
    await Promise.all(messages.map(async (item) => {
        await handleMessages(connection, item);
    }))
    await emailClient.disconnect(connection);
}

/**
 * Starts the event loop that regularly re-runs the processing function
 * @returns {Promise<void>} Promise that resolves when event loop stops (should be never)
 */
async function startProcessing() {
    while (true) {
        await runSingle();
        await sleep(process.env.emailCheckInterval || 30000)
    }
}

startProcessing()
