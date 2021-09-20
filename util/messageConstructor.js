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
    if (mail.subject === "Message from Answerphone") {
        let parsed = emailParser.parseMessageFromAnswerphone(mail.text);
        let message = createMessageFromAnswerphone(parsed);
        return [message, "Call"]
    } else if (mail.subject.includes("New submission from")) {
        let parsed = emailParser.parseMessageFromWebsite(mail.text);
        let message = createMessageFromWebsite(parsed);
        return [message, "Website"]
    } else if (mail.subject.includes("You received a new request from")) {
        let parsed = emailParser.parseMessageFromJobber(mail.text);
        let message = createMessageFromJobber(parsed);
        return [message, "Jobber Request"]
    }
    return [null, null]
}

/**
 * Creates a standard contact message based on email from Answerphone
 * @param parsed Email body
 * @returns {string} The standard contact message
 */
function createMessageFromAnswerphone(parsed) {
    let fullAddress = parsed['address'] + ", " + parsed['city'] + " " + parsed['state'] + ", " + parsed['zip'];
    let fullAddressForLink = fullAddress.replace(/\s/g, '+');
    let message;
    if (parsed['phone'] === parsed['callerid']) {
        message = `=== New Call ===\n` +
            `Caller: ${parsed['name']} ( ${parsed['phone']} )\n` +
            `Address: <https://www.google.com/maps?hl=en&q=${fullAddressForLink}|${fullAddress}>\n` +
            `Message: ${parsed['message']}`;
    } else {
        message = `=== New Call ===\n` +
            `Caller: ${parsed['name']} ( Left ${parsed['phone']} but called from: ${parsed['callerid']})\n` +
            `Address: <https://www.google.com/maps?hl=en&q=${fullAddressForLink}|${fullAddress}>\n` +
            `Message: ${parsed['message']}`;
    }
    return message;
}

/**
 * Creates a standard contact message based on email from the website contact form
 * @param parsed Email body
 * @returns {string} The standard contact message
 */
function createMessageFromWebsite(parsed) {
    let fullAddress = parsed['address'];
    let fullAddressForLink = fullAddress.replace(/\s/g, '+');
    let message;
    if (parsed['address'] === "[text your-address]") {
        message = `=== New Message From Website ===\n` +
            `Caller: ${parsed['name']} ( ${parsed['phone']} ) ( ${parsed['email']} )\n` +
            `Address: None Given\n` +
            `Subject: ${parsed['subject']}\n` +
            `Message: ${parsed['message']}`;
    } else {
        message = `=== New Message From Website ===\n` +
            `Caller: ${parsed['name']} ( ${parsed['phone']} ) ( ${parsed['email']} )\n` +
            `Address: <https://www.google.com/maps?hl=en&q=${fullAddressForLink}|${fullAddress}>\n` +
            `Message: ${parsed['message']}`;
    }
    return message;
}

/**
 * Creates a standard contact message based on email from the website contact form
 * @param parsed Email body
 * @returns {string} The standard contact message
 */
function createMessageFromJobber(parsed) {
    let fullAddress = parsed['address'];
    let fullAddressForLink = fullAddress.replace(/\s/g, '+');
    let message;
    if (parsed['address'] === "[text your-address]") {
        message = `=== New Message From Jobber Request ===\n` +
            `Caller: ${parsed['name']} ( ${parsed['phone']} ) ( ${parsed['email']} )\n` +
            `Address: None Given\n` +
            `Subject: ${parsed['subject']}\n` +
            `Message: ${parsed['message']}`;
    } else {
        message = `=== New Message From Jobber Request ===\n` +
            `Caller: ${parsed['name']} ( ${parsed['phone']} ) ( ${parsed['email']} )\n` +
            `Address: <https://www.google.com/maps?hl=en&q=${fullAddressForLink}|${fullAddress}>\n` +
            `Message: ${parsed['message']}`;
    }
    return message;
}