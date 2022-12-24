require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
const { PostHog: Posthog } = require('posthog-node');
const crypto = require('crypto');
let Contact = require('./contact.js');
const { searchPlace } = require("./apis/Google-Maps");

const fetch = require('node-fetch');

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
 * Runs an individual search against the PostHog API
 * @param searchQuery The query to make
 * @returns {Promise<*>} The parsed API response
 */
async function individualSearch(searchQuery) {
    let query = encodeURIComponent(JSON.stringify(searchQuery));
    let url = `https://app.posthog.com/api/projects/${process.env.POSTHOG_PROJECT_ID}/persons/?properties=${query}`;
    let response = [];
    try {
        response = await fetch(url, {
            method: 'get',
            headers: {'Authorization': `Bearer ${process.env.POSTHOG_API_TOKEN}`}
        }).catch(e => console.log(`Error when making PostHog API call ${e}`));
    } catch (e) {
        console.log(`Failed to run a PostHog API search.`);
        console.log(e);
    }

    let data = [];
    try {
        data = await response.text().catch(e => console.log(`Error when getting text from PostHog API call ${e}`));
    } catch (e) {
        console.log(`Failed to get text from PostHog API search.`);
        console.log(e);
    }
    data = JSON.parse(data);
    return data;
}

/**
 * Searches PostHog for a Contact
 * @param contact The contact to search for
 * @returns {undefined|string} The id of the first matching PostHog Person, or `undefined` if none
 */
async function searchForUser(contact) {
    // If contact doesn't have data to search with, return undefined
    if (contact.name === undefined &&
        contact.email === undefined &&
        contact.phone === undefined &&
        contact.alternatePhone === undefined &&
        contact.address === undefined) {
        return undefined;
    }

    // This will store all found IDs that match (can store the same one multiple times)
    let potentialIDs = []

    // Search all contact parts
    if (contact.name !== undefined) {
        let query = [{
            key: "name",
            value: contact.name,
            operator: "exact",
            type: "person"
        }];
        let results = await individualSearch(query).catch(e => console.log(e));
        if (results.length !== undefined) {
            for (let result of results.results) {
                potentialIDs.push(result.distinct_ids[0]);
            }
        }
    }
    if (contact.email !== undefined) {
        let query = [{
            key: "email",
            value: contact.email,
            operator: "exact",
            type: "person"
        }];
        let results = await individualSearch(query);
        if (results.length !== undefined) {
            for (let result of results.results) {
                potentialIDs.push(result.distinct_ids[0]);
            }
        }
    }
    if (contact.alternatePhone !== undefined) {
        let query = [{
            key: "alternatePhone",
            value: contact.alternatePhone,
            operator: "exact",
            type: "person"
        }];
        let results = await individualSearch(query);
        if (results.length !== undefined) {
            for (let result of results.results) {
                potentialIDs.push(result.distinct_ids[0]);
            }
        }
    }
    if (contact.address !== undefined) {
        let query = [{
            key: "address",
            value: contact.address,
            operator: "exact",
            type: "person"
        }];
        let results = await individualSearch(query);
        if (results.length !== undefined) {
            for (let result of results.results) {
                potentialIDs.push(result.distinct_ids[0]);
            }
        }
    }

    // let result = await searchForUser(searchQuery);

    if (potentialIDs.length === 0) {
        return undefined;
    }

    // Count occurrences in the array of possible, and return the most frequent one
    // This is because a person will likely match more searches if they match
    let counts = potentialIDs.reduce((a, c) => {
        a[c] = (a[c] || 0) + 1;
        return a;
    }, {});
    let maxCount = Math.max(...Object.values(counts));
    let mostFrequent = Object.keys(counts).filter(k => counts[k] === maxCount);

    return mostFrequent[0];
}

/**
 * Logs a contact to PostHog
 * @param contact The Contact that was parsed
 * @param originalMessage The message that was parsed into a contact.
 */
async function logContact(contact, originalMessage) {
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
    let clientLocationData = {};
    if (place !== undefined) {
        if (place.results.length > 0) {
            clientLocationData = {
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

    // Search for the person in PostHog
    let id = crypto.randomBytes(16).toString('hex');
    let posthogPerson = await searchForUser(contact);

    // If this is a new person, add them to PostHog
    if (posthogPerson === undefined) {
        console.log(`Adding ${contact.name} to PostHog`);

        // Identify the user to allow PostHog to display client details properly
        let identifyData = {
            distinctId: id,
            properties: {
                name: contact.name,
                phone: contact.phone,
                alternatePhone: contact.phone,
                email: contact.email,
                address: contact.address,
                $set: clientLocationData
            }
        }
        client.identify(identifyData)
    } else {
        id = posthogPerson;
        console.log(`Matched ${contact.name} to PostHog ID ${id}`)
    }

    // Create an event for the person in PostHog
    let captureData = {
        distinctId: id,
        event: 'contact made',
        properties: {
            type: contact.type,
            message: contact.message,
            originalMessage: originalMessage,
            $set: clientLocationData
        }
    };
    client.capture(captureData);

    // Send all queued data to PostHog
    client.flush();
}

module.exports = {
    logContact
};
