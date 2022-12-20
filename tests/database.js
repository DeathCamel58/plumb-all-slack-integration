const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const _ = require('lodash');
const Database = require('../util/database.js');
const Contact = require('../util/contact.js');

// We can group similar tests inside a `describe` block
describe("Database Class", () => {
    // We can add nested blocks for different tests
    describe( "Connection", () => {
        it("Create When Doesn't Exist", () => {
            let randomDatabaseName = crypto.randomBytes(16).toString('hex');
            console.log(`Using the random database name: ${randomDatabaseName}`);

            let db = new Database(randomDatabaseName);

            let exists = fs.existsSync(`data/${randomDatabaseName}.db`);
            fs.unlinkSync(`data/${randomDatabaseName}.db`);
            assert.equal(exists, true);
        });

        // TODO: Verify successful connection to existing database
        // it("Connect When Exists", () => {
        //     assert.equal(contact.name, "Test Name");
        // });
    });

    describe( "Database Operations", () => {
        // Call contacts
        it("Add and read back contact", () => {
            let contact = new Contact("Call", "Test Name", "555-123-4567", "123-456-7890", "an@email.com", "240 Wallaby Way, Sydney Australia", "This is a test message.");

            let db = new Database('UnitTesting');

            db.addContact(contact, "This is the original message!");
            let result = db.query(`SELECT * from contacts WHERE id = 1;`);

            fs.unlinkSync(`data/UnitTesting.db`);

            let expectedResult = {
                id: 1,
                type: "Call",
                name: "Test Name",
                phone: "555-123-4567",
                alternatePhone: "123-456-7890",
                email: "an@email.com",
                address: "240 Wallaby Way, Sydney Australia",
                message: "This is a test message.",
                original: "This is the original message!",
                timestamp: '2022-12-15 15:34:19'
            };

            console.log(expectedResult)
            console.log(result[0])

            assert.equal(_.isEqual(result[0], expectedResult), true);
        });
    });
});