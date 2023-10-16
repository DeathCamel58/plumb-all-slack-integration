// noinspection JSIgnoredPromiseFromCall

let Contact = require('./contact.js');

module.exports = {
    parseMessageFromWebsite,
    cleanText
};

/**
 * Takes email body from website contact form, and generates an array of contact information
 * @param message Email body
 * @returns {Contact} Contact Object
 */
function parseMessageFromWebsite(message) {
    let parts = message.split("________________________________");
    let phone = cleanText(parts[2].split("phone:")[1]);
    let name = cleanText(parts[0].split("name:")[1]);
    let email = cleanText(parts[1].split("email:")[1]);
    let address = cleanText(parts[3].split("address:")[1]);
    let contactMessage = cleanText(parts[5].split("message:")[1]);

    return new Contact("Message From Website", name, phone, undefined, email, address, contactMessage);
}

/**
 * Takes in dirty, ugly text (with newlines, duplicate spaces, etc.) and returns a pretty version
 * @param textToClean The ugly text to clean
 * @returns {string} The pretty text
 */
function cleanText(textToClean) {
    if (textToClean === undefined || textToClean === "") {
        return "";
    }
    let cleaned = textToClean;

    // Replace newlines and carriage returns with spaces
    cleaned = cleaned.replace(/\n+/g, ' ');
    cleaned = cleaned.replace(/\r+/g, ' ');

    // Replace ~s with space
    cleaned = cleaned.replace(/~+/g, ' ');

    // Replace -s with space
    cleaned = cleaned.replace(/--+/g, ' ');

    // Replace multiple spaces with single space
    cleaned = cleaned.replace(/\s+/g, ' ');

    // Replace leading and trailing spaces
    cleaned = cleaned.replace(/^\s+|\s+$/g, '');

    return cleaned;
}
