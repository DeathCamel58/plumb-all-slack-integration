let Contact = require('./contact.js');
let Database = require('./database.js');
module.exports = {
    parseMessageFromAnswerphone,
    parseMessageFromWebsite,
    parseMessageFromJobber,
    parseMessageFromGoogleAds,
    normalizePhoneNumber,
    cleanText
}

const db = new Database('Calls');

/**
 * Takes email body from Answerphone service, and generates an array of contact information
 * @param message Email body
 * @returns {Contact} Contact Object
 */
function parseMessageFromAnswerphone(message) {
    let phone = message.split("<D: ")[1].split(" > ")[0];
    if (normalizePhoneNumber(phone)!= null) {
        phone = normalizePhoneNumber(phone);
    }
    let name = cleanText(message.split("CALLER:  ")[1].split("\n")[0]);
    let address = cleanText(message.split("ADDRESS:  ")[1].split("\n")[0]);
    let city = cleanText(message.split("CITY:  ")[1].split(" ST  ")[0]);
    let state = cleanText(message.split("CITY:  ")[1].split(" ST  ")[1].split("ZIP ")[0]);
    let zip = cleanText(message.split("ZIP ")[1].split("\n")[0]);
    let fullAddress = address + ", " + city + " " + state + ", " + zip;
    let contactMessage = cleanText(message.split("RE: ")[1].split("~ CALLERID:")[0]);
    let callerid = cleanText(message.split("CALLERID:  ")[1].split("MSGID: ")[0]);
    if (normalizePhoneNumber(callerid)!= null) {
        callerid = normalizePhoneNumber(callerid);
    }

    let contact = new Contact("Call", name, phone, callerid, undefined, fullAddress, contactMessage);
    db.addContact(contact, message);
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
    if (normalizePhoneNumber(phone)!= null) {
        phone = normalizePhoneNumber(phone);
    }
    let name = cleanText(parts[0].split("name:")[1]);
    let email = cleanText(parts[1].split("email:")[1]);
    let address = cleanText(parts[3].split("address:")[1]);
    let contactMessage = cleanText(parts[5].split("message:")[1]);

    let contact = new Contact("Message From Website", name, phone, undefined, email, address, contactMessage);
    db.addContact(contact, message);
    return contact;
}

/**
 * Takes email body from Jobber, and generates an array of contact information
 * @param message Email body
 * @returns {Contact} Array of contact details
 */
function parseMessageFromJobber(message) {
    let phone = cleanText(message.split("Phone")[1].split("Address")[0]);
    if (normalizePhoneNumber(phone)!= null) {
        phone = normalizePhoneNumber(phone);
    }
    let name = cleanText(message.split("Contact name")[1].split("Email")[0]);
    let email = cleanText(message.split("Email")[1].split("Phone")[0]);
    let address = cleanText(message.split("\nAddress")[1].split("View Request")[0]);
    let contactMessage = cleanText(message.split("View Request")[1].split("\n")[0].split(">")[0]);
    contactMessage = contactMessage + "|Details in Jobber> (You may have to hold on that link, copy it, and paste it into your web browser to access it)";

    let contact = new Contact("Message From Jobber Request", name, phone, undefined, email, address, contactMessage);
    db.addContact(contact, message);
    return contact;
}

/**
 * Takes email body from Google Ads leads form, and generates an array of contact information
 * @param message Email body
 * @returns {Contact} Array of contact details
 */
function parseMessageFromGoogleAds(message) {
    let details = [];

    message.user_column_data.forEach(function(item) {
        if (item.column_id === "FIRST_NAME") (
            details['name'] = item.string_value
        )
        else if (item.column_id === "LAST_NAME") {
            details['name'] += " " + item.string_value
        }
        else if (item.column_id === "PHONE_NUMBER") {
            details['phone'] = item.string_value
        }
        else if (item.column_id === "EMAIL") {
            details['email'] = item.string_value
        }
        else if (item.column_id === "CITY") {
            details['city'] = item.string_value
        }
        else if (item.column_id === "SERVICE") {
            details['message'] = item.string_value
        }
    });

    if (typeof(details['phone']) !== 'undefined'){
        if (normalizePhoneNumber(details['phone'])!= null) {
            details['phone'] = normalizePhoneNumber(details['phone']);
        }
    }

    let contact = new Contact("Lead from Google Ads", details['name'], details['phone'], undefined, details['email'], details['city'], details['message']);
    db.addContact(contact, message);
    return contact;
}

/**
 * Takes in a phone number, and returns the number in the standard format: `(xxx) xxx-xxxx`
 * @param phone Unparsed phone number
 * @returns {null|*} Parsed Phone Number
 */
function normalizePhoneNumber(phone) {
    //normalize string and remove all unnecessary characters
    phone = phone.replace(/\D/g, "");

    //check if number length equals to 10
    if (phone.length === 11) {
        phone = phone.slice(1)
    }
    if (phone.length === 10) {
        //reformat and return phone number
        return phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3");
    }

    return null;
}

/**
 * Takes in dirty, ugly text (with newlines, duplicate spaces, etc) and returns a pretty version
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
