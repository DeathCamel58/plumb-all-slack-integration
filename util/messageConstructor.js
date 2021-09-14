const emailParser = require("./emailParser.js");
module.exports = {
    createMessage
}

function createMessage(mail) {
    if (mail.subject === "Message from Answerphone") {
        let parsed = emailParser.parseMessageFromAnswerphone(mail.text);
        let message = createMessageFromAnswerphone(parsed);
        return [message, "Call"]
    } else if (mail.subject.includes("New submission from")) {
        let parsed = emailParser.parseMessageFromWebsite(mail.text);
        let message = createMessageFromWebsite(parsed);
        return [message, "Website"]
    }
    return [null, null]
}

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