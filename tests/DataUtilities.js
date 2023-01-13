const assert = require('assert');
const Contact = require('../util/contact.js');
const DataUtilities = require("../util/DataUtilities");

// We can group similar tests inside a `describe` block
describe("Data Utilities", () => {
    // Test Phone Number Cleanup
    describe("Phone Number Cleanup", () => {
        it("Normalize Phone Number (spaces)", () => {
            let normalized = DataUtilities.normalizePhoneNumber("1 2 3 4 5 6 7 8 9 0");
            assert.equal(normalized, "(123) 456-7890");
        });
        it("Normalize Phone Number (leading and trailing spaces)", () => {
            let normalized = DataUtilities.normalizePhoneNumber(" 1234567890 ");
            assert.equal(normalized, "(123) 456-7890");
        });
        it("Normalize Phone Number (hyphens)", () => {
            let normalized = DataUtilities.normalizePhoneNumber("123-456-7890");
            assert.equal(normalized, "(123) 456-7890");
        });
    });
});
