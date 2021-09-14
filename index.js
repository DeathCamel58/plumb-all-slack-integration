require('dotenv').config({ path: '/root/plumb-all-slack-integration/.env' });
let slack = require('./util/slackBot.js');
let messageConstructor = require('./util/messageConstructor.js');

let imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const _ = require('lodash');

let config = {
    imap: {
        user: (process.env.emailAddress || ""),
        password: (process.env.emailPassword || ""),
        host: process.env.emailHost || "outlook.office365.com",
        port: process.env.emailPort || 993,
        tls: process.env.emailTls || true
    }
};

async function handleMessage(connection, item, mail, id) {
    let [message, fromWhere] = messageConstructor.createMessage(mail);
    if (fromWhere != null) {
        await slack.sendMessage(message, fromWhere + " Contact");
        await connection.addFlags(id, "\Seen")
        if (fromWhere === "Call") {
            await connection.moveMessage(id, "Answering Service")
        } else if (fromWhere === "Website") {
            await connection.moveMessage(id, "Website Contact")
        }
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
        console.log(mail.text);
        console.log("Ignoring email...");
    }
}

async function getMessages(connection) {
    return connection.openBox('INBOX').then(async function () {
        // Fetch emails from the last 24h
        // `90 * 24` sets the time to 90 days
        let delay = 90 * 24 * 3600 * 1000;
        let yesterday = new Date();
        yesterday.setTime(Date.now() - delay);
        yesterday = yesterday.toISOString();
        let searchCriteria = ['UNSEEN', ['SINCE', yesterday]];

        let fetchOptions = {
            bodies: ['HEADER', 'TEXT', ''],
        };
        await connection.search(searchCriteria, fetchOptions).then(async function (messages) {
            await Promise.all(messages.map(async (item) => {
                await handleMessages(connection, item);
            }))
        });
    });
}

async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    })
}

async function runSingle() {
    let connection = await imaps.connect(config)
    await getMessages(connection);
}

async function run() {
    while (true) {
        await runSingle();
        await sleep(process.env.emailCheckInterval || 30000)
    }
}
run()
