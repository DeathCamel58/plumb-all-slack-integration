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
            ${contact.type ? '\'' + contact.type.replace('\'', '&apos;').replace('"', '&quot') + '\'' : 'NULL'},
            ${contact.name ? '\'' + contact.name.replace('\'', '&apos;').replace('"', '&quot') + '\'' : 'NULL'},
            ${contact.phone ? '\'' + contact.phone.replace('\'', '&apos;').replace('"', '&quot') + '\'' : 'NULL'},
            ${contact.alternatePhone ? '\'' + contact.alternatePhone.replace('\'', '&apos;').replace('"', '&quot') + '\'' : 'NULL'},
            ${contact.email ? '\'' + contact.email.replace('\'', '&apos;').replace('"', '&quot') + '\'' : 'NULL'},
            ${contact.address ? '\'' + contact.address.replace('\'', '&apos;').replace('"', '&quot') + '\'' : 'NULL'},
            ${contact.message ? '\'' + contact.message.replace('\'', '&apos;').replace('"', '&quot') + '\'' : 'NULL'},
            ${originalMessage ? '\'' + originalMessage.replace('\'', '&apos;').replace('"', '&quot') + '\'' : 'NULL'});
        `).run();
        this.db.close();
    }
}

module.exports = Database;