// noinspection JSIgnoredPromiseFromCall

let Contact = require('./contact.js');
let APICoordinator = require("./APICoordinator");

module.exports = {
    parseMessageFromAnswerphone,
    parseMessageFromWebsite,
    cleanText
}

/**
 * Takes email body from Answerphone service, and generates an array of contact information
 * @param message Email body
 * @returns {Contact} Contact Object
 */
function parseMessageFromAnswerphone(message) {
    let phone = message.split("<D: ")[1].split(" > ")[0];
    let name = cleanText(message.split("CALLER:  ")[1].split("\n")[0]);
    let address = cleanText(message.split("ADDRESS:  ")[1].split("\n")[0]);
    let city = cleanText(message.split("CITY:  ")[1].split(" ST  ")[0]);
    let state = cleanText(message.split("CITY:  ")[1].split(" ST  ")[1].split("ZIP ")[0]);
    let zip = cleanText(message.split("ZIP ")[1].split("\n")[0]);
    let fullAddress = address + ", " + city + " " + state + ", " + zip;
    let contactMessage = cleanText(message.split("RE: ")[1].split("~ CALLERID:")[0]);
    let callerid = cleanText(message.split("CALLERID:  ")[1].split("MSGID: ")[0]);

    let contact = new Contact("Call", name, phone, callerid, undefined, fullAddress, contactMessage);
    APICoordinator.contactMade(contact, message);
    return contact;
}

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

    let contact = new Contact("Message From Website", name, phone, undefined, email, address, contactMessage);
    APICoordinator.contactMade(contact, message);
    return contact;
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
