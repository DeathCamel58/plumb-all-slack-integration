import events from "./events.js";

/**
 * When a contact is made, this will tell all APIs.
 * @param contact The Contact that was gotten
 * @param originalMessage The original message we parsed out
 * @returns {Promise<void>}
 */
export async function contactMade(contact, originalMessage) {
  events.emit(
    "slackbot-send-message",
    contact.messageToSend(),
    `${contact.type} Contact`,
  );
  events.emit(
    "mattermost-send-message",
    contact.messageToSend(true),
    `${contact.type} Contact`,
  );
  events.emit("posthog-log-contact", contact, originalMessage);
  events.emit("trello-add-contact", contact);
}
events.on("contact-made", contactMade);

/**
 * When feedback is made, this will tell all APIs.
 * @returns {Promise<void>}
 * @param name The client name
 * @param phone The client phone number
 * @param message The client's message
 */
export async function feedbackMade(name, phone, message) {
  const messageToSend = `=== New Feedback ===\nName: ${name}\nPhone: ${phone}\nMessage: ${message}`;

  events.emit("slackbot-send-message", messageToSend, "Client Feedback");
  events.emit("mattermost-send-message", messageToSend, "Client Feedback");
}
events.on("feedback-made", feedbackMade);
