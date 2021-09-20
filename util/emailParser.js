module.exports = {
    parseMessageFromAnswerphone,
    parseMessageFromWebsite,
    parseMessageFromJobber
}

/**
 * Takes email body from Answerphone service, and generates an array of contact information
 * @param message Email body
 * @returns {*[]} Array of contact details
 */
function parseMessageFromAnswerphone(message) {
    let details = [];
    details['phone'] = message.split("<D: ")[1].split(" > ")[0];
    if (normalizePhoneNumber(details['phone'])!= null) {
        details['phone'] = normalizePhoneNumber(details['phone']);
    }
    details['name'] = message.split("CALLER:  ")[1].split("\n")[0].replace(/\s+/g, ' ').slice(0, -1);
    details['address'] = message.split("ADDRESS:  ")[1].split("\n")[0].replace(/\s+/g, ' ').slice(0, -1);
    details['city'] = message.split("CITY:  ")[1].split("\n")[0].replace(/\s+/g, ' ').slice(0, -1);
    details['state'] = message.split("STATE:  ")[1].split("ZIP:  ")[0].replace(/\s+/g, '');
    details['zip'] = message.split("ZIP:  ")[1].split("\n")[0].replace(/\s+/g, '');
    details['message'] = message.split("RE:  ")[1].split("~ CALLERID")[0].replace(/(?:\r\n|\r|\n)/g, ' ').replace('~', '').replace(/\s+/g, ' ').slice(0, -1);
    details['callerid'] = message.split("CALLERID:  ")[1].split("MSGID: ")[0].replace(/\s/g, '');
    if (normalizePhoneNumber(details['callerid'])!= null) {
        details['callerid'] = normalizePhoneNumber(details['callerid']);
    }
    return details;
}

/**
 * Takes email body from website contact form, and generates an array of contact information
 * @param message Email body
 * @returns {*[]} Array of contact details
 */
function parseMessageFromWebsite(message) {
    let details = [];
    details['phone'] = message.split("phone:")[1].split("address")[0].replace(/\-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    if (normalizePhoneNumber(details['phone'])!= null) {
        details['phone'] = normalizePhoneNumber(details['phone']);
    }
    details['name'] = message.split("name:")[1].split("email")[0].replace(/\-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    details['email'] = message.split("email:")[1].split("phone")[0].replace(/\-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    details['address'] = message.split("address:")[1].split("website")[0].replace(/\-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    details['message'] = message.split("message:")[1].split("Submitted at")[0].replace(/(?:\r\n|\r|\n|\-)/g, ' ').replace('~', '').replace(/\s+/g, ' ');
    return details;
}

/**
 * Takes email body from Jobber, and generates an array of contact information
 * @param message Email body
 * @returns {*[]} Array of contact details
 */
function parseMessageFromJobber(message) {
    let details = [];
    details['phone'] = message.split("Phone:")[1].split("Address")[0].replace(/\-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').slice(1, -1);
    if (normalizePhoneNumber(details['phone'])!= null) {
        details['phone'] = normalizePhoneNumber(details['phone']);
    }
    details['name'] = message.split("Contact name:")[1].split("Email")[0].replace(/\-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').slice(1, -1);
    details['email'] = message.split("Email:")[1].split("Phone")[0].replace(/\-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').slice(1, -1);
    details['address'] = message.split("Address:")[1].split("View Request")[0].replace(/\-+/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').replace(/&quot;+/g, '"').slice(1, -1);
    details['message'] = message.split("View Request:")[1].split("\n")[0].replace(/(?:\r\n|\r|\n)/g, ' ').replace(/\s+/g, ' ').slice(1);
    details['message'] = "<" + details['message'] + "|Details in Jobber> (You may have to hold on that link, copy it, and paste it into your web browser to access it)"
    return details;
}

/**
 * Takes in a phone number, and returns the number in the standard format: `(xxx) xxx-xxxx`
 * @param phone Unparsed phone number
 * @returns {null|*} Parsed Phone Number
 */
function normalizePhoneNumber(phone) {
    //normalize string and remove all unnecessary characters
    phone = phone.replace(/[^\d]/g, "");

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