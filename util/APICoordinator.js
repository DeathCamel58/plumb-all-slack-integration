const events = require("./events");

/**
 * When a contact is made, this will tell all APIs.
 * @param contact The Contact that was gotten
 * @param originalMessage The original message we parsed out
 * @returns {Promise<void>}
 */
async function contactMade(contact, originalMessage) {
  events.emitter.emit(
    "slackbot-send-message",
    contact.messageToSend(),
    `${contact.type} Contact`,
  );
  events.emitter.emit(
    "mattermost-send-message",
    contact.messageToSend(true),
    `${contact.type} Contact`,
  );
  events.emitter.emit("posthog-log-contact", contact, originalMessage);
  events.emitter.emit("trello-add-contact", contact);
}

events.emitter.on("contact-made", contactMade);

module.exports = {
  contactMade,
};
