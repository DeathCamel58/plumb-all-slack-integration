require('dotenv').config({ path: process.env.PATH || '/root/plumb-all-slack-integration/.env' });
let slack = require('./util/slackBot.js');
let messageConstructor = require('./util/messageConstructor.js');
let emailClient = require('./util/emailClient.js')

const simpleParser = require('mailparser').simpleParser;
const _ = require('lodash');

async function handleMessage(connection, item, mail, id) {
    let [message, fromWhere] = messageConstructor.createMessage(mail);
    if (fromWhere != null) {
        await slack.sendMessage(message, fromWhere + " Contact");
        await emailClient.moveAndMarkEmail(connection, id, fromWhere)
    }
}

async function handleMessages(connection, item) {
    let all = _.find(item.parts, { "which": "" })
    let id = item.attributes.uid;
    let idHeader = "Imap-Id: "+id+"\r\n";

    let mail = await simpleParser(idHeader+all.body);
    if (!mail.text.includes("Email of All Messages to 3646 PLUMB-ALL")) {
        await handleMessage(connection, item, mail, id);
    } else {
        console.log("Ignoring email (it's a concatenation of all previous day's emails)...");
    }
}

async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    })
}

async function runSingle() {
    let connection = await emailClient.connect();
    let connect = await emailClient.connectToMail(connection);
    let messages = await emailClient.getNewMail(connection)
    await Promise.all(messages.map(async (item) => {
        await handleMessages(connection, item);
    }))
    await emailClient.disconnect(connection);
}

async function run() {
    while (true) {
        await runSingle();
        await sleep(process.env.emailCheckInterval || 30000)
    }
}
run()
