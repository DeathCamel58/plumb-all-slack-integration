require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
const { PostHog: Posthog } = require('posthog-node');
const crypto = require('crypto');
let Contact = require('./contact.js');

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
function logContact(contact, originalMessage) {
    console.log("Sending contact to PostHog");
    let randomID = crypto.randomBytes(16).toString('hex');

    // TODO: Check if the user already exists in PostHog, and use their `distinctID` if they do

    // Identify the user to allow PostHog to display client details properly
    // TODO: Integrate with Google Maps to get location data for PostHog
    // Ref: https://posthog.com/docs/integrate/user-properties#geoip-properties
    let identifyData = {
        distinctId: randomID,
        properties: {
            name: contact.name,
            phone: contact.phone,
            alternatePhone: contact.phone,
            email: contact.email,
            address: contact.address,
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
            originalMessage: originalMessage
        }
    };
    client.capture(captureData);

    // Send all queued data to PostHog
    client.flush();
}

module.exports = {
    logContact
};
