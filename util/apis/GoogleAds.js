const Contact = require("../contact");
const GoogleMaps = require("./GoogleMaps");
const SlackBot = require("./SlackBot");
const PostHog = require("./PostHog");

/**
 * Processes a Google Ads Lead form webhook
 * @param data the data that was received
 * @returns {Promise<void>}
 * @constructor
 */
async function LeadFormHandle(data) {
    // Map all data into a dict
    let userData = {};
    for (let i = 0; i < data["user_column_data"].length; i++) {
        userData[data["user_column_data"][i]["column_id"]] = data["user_column_data"][i]["string_value"];
    }

    // Look up the address in Google Maps, and set location to store the correct address
    let location = (userData["STREET_ADDRESS"] ? userData["STREET_ADDRESS"] + ' ' : '') +
        (userData["CITY"] ? userData["CITY"] + ' ' : '') +
        (userData["POSTAL_CODE"] ? userData["POSTAL_CODE"] : '');
    location = await GoogleMaps.searchPlace(location);
    if (location !== null) {
        if (location.length > 0) {
            location = location[0].formatted_address;
        } else {
            location = undefined;
        }
    } else {
        location = undefined;
    }

    // Format the name properly
    let name = (userData["FULL_NAME"] ? userData["FULL_NAME"] : '');

    // Create a contact object
    let contact = new Contact("Google Ads", name, userData["PHONE_NUMBER"], undefined, undefined, location, userData['can_you_describe_your_plumbing_issue?']);

    SlackBot.sendMessage(contact.messageToSend(), 'Google Ads Contact');
    PostHog.logContact(contact, JSON.stringify(data));
}

module.exports = {
    LeadFormHandle
};
