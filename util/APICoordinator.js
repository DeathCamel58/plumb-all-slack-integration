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

/**
 * When feedback is made, this will tell all APIs.
 * @returns {Promise<void>}
 * @param name The client name
 * @param phone The client phone number
 * @param message The client's message
 */
async function feedbackMade(name, phone, message) {
  const messageToSend = `=== New Feedback ===\nName: ${name}\nPhone: ${phone}\nMessage: ${message}`;

  events.emitter.emit(
    "slackbot-send-message",
    messageToSend,
    "Client Feedback",
  );
  events.emitter.emit(
    "mattermost-send-message",
    messageToSend,
    "Client Feedback",
  );
}
events.emitter.on("feedback-made", feedbackMade);

module.exports = {
  contactMade,
  feedbackMade,
};
