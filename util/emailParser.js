let Contact = require('./contact.js');
module.exports = {
    parseMessageFromAnswerphone,
    parseMessageFromWebsite,
    parseMessageFromJobber,
    parseMessageFromGoogleAds
}

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
    let name = message.split("CALLER:  ")[1].split("\n")[0].replace(/\s+/g, ' ').slice(0, -1);
    let address = message.split("ADDRESS:  ")[1].split("\n")[0].replace(/\s+/g, ' ').slice(0, -1);
    let city = message.split("CITY:  ")[1].split(" ST  ")[0].replace(/\s+/g, ' ').slice(0, -1);
    let state = message.split("CITY:  ")[1].split(" ST  ")[1].split("ZIP ")[0].replace(/\s+/g, '');
    let zip = message.split("ZIP ")[1].split("\n")[0].replace(/\s+/g, '');
    let fullAddress = address + ", " + city + " " + state + ", " + zip;
    let contactMessage = message.split("RE: ")[1].split("~ CALLERID:")[0].replace(/\r\n|\r|\n/g, ' ').replace('~', '').replace(/\s+/g, ' ').slice(0, -1);
    let callerid = message.split("CALLERID:  ")[1].split("MSGID: ")[0].replace(/\s/g, '');
    if (normalizePhoneNumber(callerid)!= null) {
        callerid = normalizePhoneNumber(callerid);
    }

    return new Contact("Call", name, phone, callerid, undefined, fullAddress, contactMessage);
}

/**
 * Takes email body from website contact form, and generates an array of contact information
 * @param message Email body
 * @returns {Contact} Contact Object
 */
function parseMessageFromWebsite(message) {
    let phone = message.split("phone:")[1].split("address")[0].replace(/-/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    if (normalizePhoneNumber(phone)!= null) {
        phone = normalizePhoneNumber(phone);
    }
    let name = message.split("name:")[1].split("email")[0].replace(/-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    let email = message.split("email:")[1].split("phone")[0].replace(/-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    let address = message.split("address:")[1].split("website")[0].replace(/-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    let contactMessage = message.split("message:")[1].split("Submitted at")[0].replace(/\r\n|\r|\n|-/g, ' ').replace('~', '').replace(/\s+/g, ' ');

    return new Contact("Message From Website", name, phone, undefined, email, address, contactMessage);
}

/**
 * Takes email body from Jobber, and generates an array of contact information
 * @param message Email body
 * @returns {Contact} Array of contact details
 */
function parseMessageFromJobber(message) {
    let phone = message.split("PHONE")[1].split("ADDRESS")[0].replace(/-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').slice(1, -1);
    if (normalizePhoneNumber(phone)!= null) {
        phone = normalizePhoneNumber(phone);
    }
    let name = message.split("CONTACT NAME")[1].split("EMAIL")[0].replace(/-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').slice(1, -1);
    let email = message.split("EMAIL")[1].split("PHONE")[0].replace(/-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').slice(1, -1);
    let address = message.split("ADDRESS")[1].split("View Request")[0].replace(/-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').replace(/&quot;+/g, '"').slice(1, -1);
    let contactMessage = message.split("View Request")[1].slice(2).split("\n")[0].replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').slice(0, -1);
    contactMessage = "<" + contactMessage + "|Details in Jobber> (You may have to hold on that link, copy it, and paste it into your web browser to access it)";

    return new Contact("Message from Jobber Request", name, phone, undefined, email, address, contactMessage);
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

    return new Contact("Lead from Google Ads", details['name'], details['phone'], undefined, details['email'], details['city'], details['message']);
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