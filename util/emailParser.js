module.exports = {
    parseMessageFromAnswerphone,
    parseMessageFromWebsite
}

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

function normalizePhoneNumber(phone) {
    //normalize string and remove all unnecessary characters
    phone = phone.replace(/[^\d]/g, "");

    //check if number length equals to 10
    if (phone.length == 10) {
        //reformat and return phone number
        return phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3");
    }

    return null;
}