let imaps = require('imap-simple');

module.exports = {
    connect,
    openInbox,
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

/**
 * Connects to email server
 * @returns {Promise<Promise|undefined>} imap-simple connection
 */
async function connect() {
    return imaps.connect(config)
}

/**
 * Uses pre-existing connection to open the `INBOX` folder on server
 * @param connection imap-simple connection
 * @returns {Promise<*>} Opened inbox
 */
async function openInbox(connection) {
    return connection.openBox('INBOX');
}

/**
 * Searches for unread emails within a certain timeframe
 * @param connection imap-simple connection
 * @param sinceTime Number of milliseconds to look back in the search for new emails
 * @returns {Promise<*>} Promise that resolves after search completed and resolves to array of all unread email
 */
async function getNewMail(connection, sinceTime) {
    let yesterday = new Date();
    yesterday.setTime(Date.now() - sinceTime);
    yesterday = yesterday.toISOString();
    let searchCriteria = ['UNSEEN', ['SINCE', yesterday]];

    let fetchOptions = {
        bodies: ['HEADER', 'TEXT', ''],
    };

    return connection.search(searchCriteria, fetchOptions)
}

/**
 * Moves email to proper email folder, and marks the email as read
 * @param connection imap-simple connection
 * @param id ID of the email to handle
 * @param fromWhere Where the email originated from
 * @returns {Promise<void>} Promise that resolves after email moved and marked as read
 */
async function moveAndMarkEmail(connection, id, fromWhere) {
    await connection.addFlags(id, "\Seen")
    if (fromWhere === "Call") {
        await connection.moveMessage(id, "Answering Service")
    } else if (fromWhere === "Website") {
        await connection.moveMessage(id, "Website Contact")
    }
}

/**
 * Disconnects from email server
 * @param connection imap-simple connection
 * @returns {Promise<void>} Promise that resolves after successful disconnect from server
 */
async function disconnect(connection) {
    await connection.imap.closeBox(false, (err) => {
        if (err) {
            console.log("Error occurred while closing the inbox:")
            console.log(err);
        }
    })
    await connection.end();
}