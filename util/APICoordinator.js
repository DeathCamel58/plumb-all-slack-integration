const PostHog = require("./apis/PostHog");
const Trello = require("./apis/Trello");

/**
 * When a contact is made, this will tell all APIs.
 * @param contact The Contact that was gotten
 * @param originalMessage The original message we parsed out
 * @returns {Promise<void>}
 */
async function contactMade(contact, originalMessage) {
    PostHog.logContact(contact, originalMessage);
    Trello.addContact(contact);
}

module.exports = {
    contactMade
}
