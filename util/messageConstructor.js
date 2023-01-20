const emailParser = require("./emailParser.js");
module.exports = {
    createMessage
}

/**
 * Takes email and decides what source to process it as originating from
 * @param mail Email
 * @returns {(Contact)[]|*[]} [ human friendly message with contact information, source from which email originated ]
 */
function createMessage(mail) {
    // Process Emails
    if (typeof(mail.subject) !== 'undefined') {
        if (mail.subject === "Message from Answerphone") {
            let contact = emailParser.parseMessageFromAnswerphone(mail.body.content);
            return [contact, "Call"]
        } else if (mail.subject.includes("New submission from")) {
            let contact = emailParser.parseMessageFromWebsite(mail.body.content);
            return [contact, "Website"]
        }
        return [null, null]
    }
}
