require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
const crypto = require('crypto');
let Contact = require('./contact.js');
const { searchPlace } = require("./apis/Google-Maps");

const fetch = require('node-fetch');

/**
 * Sends a raw request to PostHog's API
 * @param url The endpoint url. E.g. `contact/`
 * @param httpMethod The HTTP method type. E.g. `post`
 * @param data The data to send to the endpoint
 * @returns {Promise<void>}
 */
async function usePostHogAPI(url, httpMethod, data) {
    let query = JSON.stringify(data);
    let response = [];
    try {
        let options = {
            method: httpMethod,
            headers: {
                'Content-Type': 'application/json'
            }
        }
        if (data !== null && data !== undefined) {
            options.body = query;
        }
        response = await fetch(`${process.env.POSTHOG_HOST}/${url}`, options)
        switch (response.status) {
            // HTTP: OK
            case 200:
                // Do nothing
                break;
            // HTTP Bad Request
            case 400:
            default:
                console.log(`Received status ${response.status} from posthog. Body follows.`);
                let text = await response.text();
                console.log(text);
        }
    } catch (e) {
        console.log(`Failed to run a PostHog API search.`);
        console.log(e);
    }
}

/**
 * Runs an individual search against the PostHog API
 * @param searchQuery The query to make
 * @param parameter The parameter to use in the URL. Defaults to `properties`.
 * @returns {Promise<*>} The parsed API response
 */
async function individualSearch(searchQuery, parameter) {
    let query = (parameter ? searchQuery : encodeURIComponent(JSON.stringify(searchQuery)));
    let url = `https://app.posthog.com/api/projects/${process.env.POSTHOG_PROJECT_ID}/persons/?${parameter ? parameter : 'properties'}=${query}`;
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
        if (results.results.length !== undefined && results.results.length !== 0) {
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
        if (results.results.length !== undefined && results.results.length !== 0) {
            for (let result of results.results) {
                potentialIDs.push(result.distinct_ids[0]);
            }
        }
    }
    if (contact.phone !== undefined) {
        let query = [{
            key: "phone",
            value: contact.phone,
            operator: "exact",
            type: "person"
        }];
        let results = await individualSearch(query);
        if (results.results.length !== undefined && results.results.length !== 0) {
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
        if (results.results.length !== undefined && results.results.length !== 0) {
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
        if (results.results.length !== undefined && results.results.length !== 0) {
            for (let result of results.results) {
                potentialIDs.push(result.distinct_ids[0]);
            }
        }
    }

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
 * Gets the data at an index of a place's address_components
 * @param place Place to find data for
 * @param addressComponentIndex Index of address_components
 * @param key Key to get value from
 * @returns {string} The data, or empty string
 */
function getPlaceLocationPart(place, addressComponentIndex, key) {
    // Check that the index exists in address_components
    if (place.results[0].address_components.length > addressComponentIndex) {
        // Check if we should return long_name or short_name
        if (key in place.results[0].address_components[addressComponentIndex]) {
            return place.results[0].address_components[addressComponentIndex][key];
        } else {
            // Neither short_name nor long_name exist at index. Return empty string
            return "";
        }
    }
}

/**
 * Logs the contact to PostHog, updating the client if they already exist
 * @param contact The client to log to PostHog
 * @returns {Promise<string>} The ID of the client in PostHog
 */
async function sendClientToPostHog(contact) {
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
    let clientData = {};
    if (place !== undefined) {
        if (place.results !== undefined) {
            if (place.results.length > 0) {
                clientData = {
                    $geoip_city_name: getPlaceLocationPart(place, 2, 'long_name'),
                    $geoip_country_code: getPlaceLocationPart(place, 5, 'short_name'),
                    $geoip_country_name: getPlaceLocationPart(place, 5, 'long_name'),
                    // $geoip_latitude: ADD THE LATITUDE,
                    // $geoip_longitude: ADD THE LONGITUDE,
                    $geoip_postal_code: getPlaceLocationPart(place, 6, 'long_name'),
                    $geoip_subdivision_1_name: getPlaceLocationPart(place, 3, 'long_name'),
                    $initial_geoip_city_name: getPlaceLocationPart(place, 2, 'long_name'),
                    $initial_geoip_country_code: getPlaceLocationPart(place, 5, 'short_name'),
                    $initial_geoip_country_name: getPlaceLocationPart(place, 5, 'long_name'),
                    // $initial_geoip_latitude: ADD THE LATITUDE,
                    // $initial_geoip_longitude: ADD THE LONGITUDE,
                    $initial_geoip_postal_code: getPlaceLocationPart(place, 6, 'long_name'),
                    $initial_geoip_subdivision_1_name: getPlaceLocationPart(place, 3, 'long_name'),
                };
            }
        }
    }

    // Search for the person in PostHog
    let id = crypto.randomBytes(16).toString('hex');
    let posthogPerson = await searchForUser(contact);

    // If this is a new person, add them to PostHog
    if (posthogPerson === undefined) {
        console.log(`Adding ${contact.name} to PostHog`);
    } else {
        id = posthogPerson;
        console.log(`Matched ${contact.name} to PostHog ID ${id}`);

        // Get the matched person in PostHog
        let fullPostHogPerson = await individualSearch(`${id}`, 'distinct_id');
        fullPostHogPerson = fullPostHogPerson.results[0];

        // If the person is the same as what we would set, don't send to PostHog. This cuts down on unnecessary events.
        let same = true;
        if (contact.name !== fullPostHogPerson.properties.name ||
            contact.phone !== fullPostHogPerson.properties.phone ||
            contact.alternatePhone !== fullPostHogPerson.properties.alternatePhone ||
            contact.email !== fullPostHogPerson.properties.email ||
            contact.address !== fullPostHogPerson.properties.address) {
            same = false;
        }
        if (same) {
            return id;
        }
    }

    // Identify the user to allow PostHog to display client details properly
    clientData.name = contact.name;
    clientData.phone = contact.phone;
    clientData.alternatePhone = contact.phone;
    clientData.email = contact.email;
    clientData.address = contact.address;
    clientData.latestContactSource = contact.type;
    let identifyData = {
        api_key: process.env.POSTHOG_TOKEN,
        distinct_id: id,
        event: '$identify',
        $set: clientData
    }

    await usePostHogAPI('capture/', 'post', identifyData);

    return id;
}

/**
 * Logs a contact to PostHog
 * @param contact The Contact that was parsed
 * @param originalMessage The message that was parsed into a contact.
 */
async function logContact(contact, originalMessage) {
    let id = await sendClientToPostHog(contact);

    // Create an event for the person in PostHog
    let captureData = {
        api_key: process.env.POSTHOG_TOKEN,
        event: 'contact made',
        properties: {
            distinct_id: id,
            type: contact.type,
            message: contact.message,
            originalMessage: originalMessage
        }
    };
    await usePostHogAPI('capture/', 'post', captureData);

    // Send all queued data to PostHog
}

/**
 * Logs a created client in Jobber to PostHog
 * @param jobberClient The Contact that was parsed
 */
async function logClient(jobberClient) {
    let defaultEmail;
    for (let i = 0; i < jobberClient.emails.length; i++) {
        if (jobberClient.emails[i].primary) {
            defaultEmail = jobberClient.emails[i].address;
        }
    }

    let defaultPhone;
    for (let i = 0; i < jobberClient.phones.length; i++) {
        if (jobberClient.phones[i].primary) {
            defaultPhone = jobberClient.phones[i].number;
        }
    }

    let contact = new Contact(null, jobberClient.name, jobberClient.phones[0].number, (defaultPhone !== undefined ? defaultPhone : null), (defaultEmail !== undefined ? defaultEmail : null), `${jobberClient.billingAddress.street} ${jobberClient.billingAddress.city} ${jobberClient.billingAddress.province} ${jobberClient.billingAddress.postalCode}`);

    return await sendClientToPostHog(contact);
}

/**
 * Logs a created Invoice in Jobber to PostHog
 * @param jobberInvoice The Invoice that was parsed
 * @param clientID The client ID to use for the event
 */
async function logInvoice(jobberInvoice, clientID) {
    // Create an event for invoice in PostHog
    let captureData = {
        api_key: process.env.POSTHOG_TOKEN,
        event: 'invoice made',
        properties: {
            distinct_id: clientID,
            subject: jobberInvoice.subject,
            invoiceNumber: jobberInvoice.invoiceNumber,
            depositAmount: jobberInvoice.amounts.depositAmount,
            discountAmount: jobberInvoice.amounts.discountAmount,
            invoiceBalance: jobberInvoice.amounts.invoiceBalance,
            paymentsTotal: jobberInvoice.amounts.paymentsTotal,
            subtotal: jobberInvoice.amounts.subtotal,
            total: jobberInvoice.amounts.total
        }
    };
    await usePostHogAPI('capture/', 'post', captureData);
}

/**
 * Logs a created quote in Jobber to PostHog
 * @param jobberQuote The quote that was parsed
 * @param clientID The client ID to use for the event
 */
async function logQuote(jobberQuote, clientID) {
    // Create an event for quote in PostHog
    let captureData = {
        api_key: process.env.POSTHOG_TOKEN,
        event: 'quote made',
        properties: {
            distinct_id: clientID,
            quoteNumber: jobberQuote.quoteNumber,
            quoteStatus: jobberQuote.quoteStatus,
            depositAmount: jobberQuote.amounts.depositAmount,
            discountAmount: jobberQuote.amounts.discountAmount,
            outstandingDepositAmount: jobberQuote.amounts.outstandingDepositAmount,
            subtotal: jobberQuote.amounts.subtotal,
            total: jobberQuote.amounts.total
        }
    };
    await usePostHogAPI('capture/', 'post', captureData);
}

/**
 * Logs a created quote in Jobber to PostHog
 * @param jobberQuote The quote that was parsed
 * @param clientID The client ID to use for the event
 */
async function logQuoteUpdate(jobberQuote, clientID) {
    // Check if the quote is not accepted
    if (jobberQuote.quoteStatus === "approved") {
        // Create an event for quote in PostHog
        let captureData = {
            api_key: process.env.POSTHOG_TOKEN,
            event: 'quote accepted',
            properties: {
                distinct_id: clientID,
                quoteNumber: jobberQuote.quoteNumber,
                quoteStatus: jobberQuote.quoteStatus,
                depositAmount: jobberQuote.amounts.depositAmount,
                discountAmount: jobberQuote.amounts.discountAmount,
                outstandingDepositAmount: jobberQuote.amounts.outstandingDepositAmount,
                subtotal: jobberQuote.amounts.subtotal,
                total: jobberQuote.amounts.total
            }
        };
        await usePostHogAPI('capture/', 'post', captureData);
    }
}

/**
 * Logs a created job in Jobber to PostHog
 * @param jobberQuote The job that was parsed
 * @param clientID The client ID to use for the event
 */
async function logJob(jobberQuote, clientID) {
    // Create an event for quote in PostHog
    let captureData = {
        api_key: process.env.POSTHOG_TOKEN,
        event: 'job made',
        properties: {
            distinct_id: clientID,
            jobNumber: jobberQuote.jobNumber,
            jobStatus: jobberQuote.jobStatus,
            title: jobberQuote.title,
            total: jobberQuote.total
        }
    };
    await usePostHogAPI('capture/', 'post', captureData);
}

module.exports = {
    logContact,
    logClient,
    logQuote,
    logQuoteUpdate,
    logJob,
    logInvoice
};
