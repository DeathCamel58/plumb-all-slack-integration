const PostHog = require("./apis/PostHog");
const Trello = require("./apis/Trello");
const SlackBot = require("./apis/SlackBot");

/**
 * When a contact is made, this will tell all APIs.
 * @param contact The Contact that was gotten
 * @param originalMessage The original message we parsed out
 * @returns {Promise<void>}
 */
async function contactMade(contact, originalMessage) {
    await SlackBot.sendMessage(contact.messageToSend(), `${contact.type} Contact`);
    await PostHog.logContact(contact, originalMessage);
    await Trello.addContact(contact);
}

module.exports = {
    contactMade
};
