require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
const { PostHog: Posthog } = require('posthog-node');
const crypto = require('crypto');
let Contact = require('./contact.js');
const { searchPlace } = require("./apis/Google-Maps");

const client = new Posthog(
    process.env.POSTHOG_TOKEN,
    {
        host: process.env.POSTHOG_HOST
    }
);

// Enable PostHog debugging if debugging is enabled
if (!!process.env.DEBUGGING) {
    client.debug(true);
}

/**
 * Logs a contact to PostHog
 * @param contact The Contact that was parsed
 * @param originalMessage The message that was parsed into a contact.
 */
async function logContact(contact, originalMessage) {
    console.log("Sending contact to PostHog");
    let randomID = crypto.randomBytes(16).toString('hex');

    // TODO: Check if the user already exists in PostHog, and use their `distinctID` if they do

    // If the contact has an address, resolve it to a place object using Google Maps
    let place;
    if (contact.address !== '' && contact.address !== undefined) {
        place = await searchPlace(contact.address);

        if (place.data.results.length > 0) {
            place = place.data;
        } else {
            console.log(`No place found for ${contact.address} on Google Maps.`);
        }
    }

    // Set the location data for the user if a place is resolved
    let $set = {};
    if (place !== undefined) {
        if (place.results.length > 0) {
            $set = {
                $geoip_city_name: place.results[0].address_components[2].long_name,
                $geoip_country_code: place.results[0].address_components[5].short_name,
                $geoip_country_name: place.results[0].address_components[5].long_name,
                // $geoip_latitude: ADD THE LATITUDE,
                // $geoip_longitude: ADD THE LONGITUDE,
                $geoip_postal_code: place.results[0].address_components[6].long_name,
                $geoip_subdivision_1_name: place.results[0].address_components[3].long_name,
                $initial_geoip_city_name: place.results[0].address_components[2].long_name,
                $initial_geoip_country_code: place.results[0].address_components[5].short_name,
                $initial_geoip_country_name: place.results[0].address_components[5].long_name,
                // $initial_geoip_latitude: ADD THE LATITUDE,
                // $initial_geoip_longitude: ADD THE LONGITUDE,
                $initial_geoip_postal_code: place.results[0].address_components[6].long_name,
                $initial_geoip_subdivision_1_name: place.results[0].address_components[3].long_name,
            };
        }
    }


    // Identify the user to allow PostHog to display client details properly
    let identifyData = {
        distinctId: randomID,
        properties: {
            name: contact.name,
            phone: contact.phone,
            alternatePhone: contact.phone,
            email: contact.email,
            address: contact.address,
            $set
        }
    }
    client.identify(identifyData)

    // Create an event for the new user
    let captureData = {
        distinctId: randomID,
        event: 'contact made',
        properties: {
            type: contact.type,
            message: contact.message,
            originalMessage: originalMessage,
            $set
        }
    };
    client.capture(captureData);

    // Send all queued data to PostHog
    client.flush();
}

module.exports = {
    logContact
};
