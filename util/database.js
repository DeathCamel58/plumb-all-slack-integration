let Sqlite3 = require('better-sqlite3');
let Contact = require('./contact.js');
const fs = require("fs");

/**
 * The database for storing call data
 */
class Database {
    /**
     * A database
     * @param dbname database file name
     */
    constructor(dbname) {
        this.databaseLocation = `data/${dbname}.db`;


        let exists = fs.existsSync(this.databaseLocation);
        this.db = new Sqlite3(this.databaseLocation);
        if (!exists) {
            this.createDatabase();
        }

        this.db.close();
    }

    /**
     * Connects to the database
     */
    connectDatabase() {
        this.db = new Sqlite3(this.databaseLocation);
    }

    /**
     * Creates the database if it doesn't exist
     */
    createDatabase() {
        this.connectDatabase();
        this.db.exec(`
        create table contacts
        (
            id             INTEGER
                constraint id
                    primary key autoincrement,
            type           TEXT,
            name           TEXT,
            phone          TEXT,
            alternatePhone TEXT,
            email          TEXT,
            address        TEXT,
            message        TEXT,
            original       TEXT not null,
            timestamp      DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        `)
        this.db.close();
    }

    /**
     * Runs a query on the database
     * @param queryString
     * @returns {Database}
     */
    query(queryString) {
        this.connectDatabase();
        let result = this.db.prepare(queryString).all();
        this.db.close();
        return result;
    }

    /**
     * Adds a contact to the database
     * @param contact The Contact that was parsed
     * @param originalMessage The message that was parsed into a contact.
     */
    addContact(contact, originalMessage) {
        this.connectDatabase();
        this.db.prepare(`
        INSERT INTO contacts (type, name, phone, alternatePhone, email, address, message, original)
        VALUES (
            ${contact.type ? '\'' + escapeQuery(contact.type) + '\'' : 'NULL'},
            ${contact.name ? '\'' + escapeQuery(contact.name) + '\'' : 'NULL'},
            ${contact.phone ? '\'' + escapeQuery(contact.phone) + '\'' : 'NULL'},
            ${contact.alternatePhone ? '\'' + escapeQuery(contact.alternatePhone) + '\'' : 'NULL'},
            ${contact.email ? '\'' + escapeQuery(contact.email) + '\'' : 'NULL'},
            ${contact.address ? '\'' + escapeQuery(contact.address) + '\'' : 'NULL'},
            ${contact.message ? '\'' + escapeQuery(contact.message) + '\'' : 'NULL'},
            ${originalMessage ? '\'' + escapeQuery(originalMessage) + '\'' : 'NULL'});
        `).run();
        this.db.close();
    }
}

/**
 * Takes an unsafe string, and encodes it to keep from causing issues
 * @param queryString The string to ensure is escaped
 * @returns {string} The escaped string
 */
function escapeQuery(queryString) {
    // Encode the string
    let escaped = encodeURIComponent(queryString);

    // Remove single quotes from the string
    escaped = escaped.replace(/'/g, "&apos;");

    return escaped;
}

module.exports = Database;
