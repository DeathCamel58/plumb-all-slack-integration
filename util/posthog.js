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

/**
 * Logs a contact to PostHog
 * @param contact The Contact that was parsed
 * @param originalMessage The message that was parsed into a contact.
 */
function logContact(contact, originalMessage) {
    console.log("Sending contact to PostHog");
    if (!!process.env.DEBUGGING) {
        console.log(contact);
        console.log(originalMessage);
    }
    let randomID = crypto.randomBytes(16).toString('hex');
    let data = {
        distinctId: randomID,
        event: 'contact made',
        properties: {
            type: contact.type,
            name: contact.name,
            phone: contact.phone,
            alternatePhone: contact.phone,
            email: contact.email,
            address: contact.address,
            message: contact.message,
            originalMessage: originalMessage
        }
    };
    if (!!process.env.DEBUGGING) {
        console.log(data);
    }

    client.capture(data);
    client.flush();
}

module.exports = {
    logContact
};
