let imaps = require('imap-simple');

module.exports = {
    connect,
    connectToMail,
    getNewMail,
    moveAndMarkEmail,
    disconnect
}

let config = {
    imap: {
        user: (process.env.emailAddress || ""),
        password: (process.env.emailPassword || ""),
        host: process.env.emailHost || "outlook.office365.com",
        port: process.env.emailPort || 993,
        tls: process.env.emailTls || true
    }
};

async function connect() {
    return imaps.connect(config)
}

async function connectToMail(connection) {
    return connection.openBox('INBOX');
}

async function getNewMail(connection) {// Fetch emails from the last 24h
    // `90 * 24` sets the time to 90 days
    let delay = 90 * 24 * 3600 * 1000;
    let yesterday = new Date();
    yesterday.setTime(Date.now() - delay);
    yesterday = yesterday.toISOString();
    let searchCriteria = ['UNSEEN', ['SINCE', yesterday]];

    let fetchOptions = {
        bodies: ['HEADER', 'TEXT', ''],
    };

    return connection.search(searchCriteria, fetchOptions)
}

async function moveAndMarkEmail(connection, id, fromWhere) {
    await connection.addFlags(id, "\Seen")
    if (fromWhere === "Call") {
        await connection.moveMessage(id, "Answering Service")
    } else if (fromWhere === "Website") {
        await connection.moveMessage(id, "Website Contact")
    }
}

async function disconnect(imapsConnection) {
    await imapsConnection.imap.closeBox(false, (err) => {
        if (err) {
            console.log("Error occurred while closing the inbox:")
            console.log(err);
        }
    })
    await imapsConnection.end();
}