const emailParser = require("./emailParser.js");
module.exports = {
    createMessage
}

/**
 * Takes email and decides what source to process it as originating from
 * @param mail Email
 * @returns {(*|string)[]|*[]} [ human friendly message with contact information, source from which email originated ]
 */
function createMessage(mail) {
    // Process Emails
    if (typeof(mail.subject) !== 'undefined') {
        if (mail.subject === "Message from Answerphone") {
            let parsed = emailParser.parseMessageFromAnswerphone(mail.body.content);
            return [parsed.messageToSend(), "Call"]
        } else if (mail.subject.includes("New submission from")) {
            let parsed = emailParser.parseMessageFromWebsite(mail.body.content);
            return [parsed.messageToSend(), "Website"]
        } else if (mail.subject.includes("You received a new request from")) {
            let parsed = emailParser.parseMessageFromJobber(mail.body.content);
            return [parsed.messageToSend(), "Jobber Request"]
        }
        return [null, null]
    }
    // Process Webhooks
    else {
        let parsed = emailParser.parseMessageFromGoogleAds(mail);
        return [parsed.messageToSend(), "Google Ads"]
    }
}
