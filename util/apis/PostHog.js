import crypto from "crypto";
import Contact from "../contact.js";
import * as GoogleMaps from "./GoogleMaps.js";
import events from "../events.js";

import fetch from "node-fetch";
import * as Sentry from "@sentry/node";

/**
 * Sends a raw request to PostHog's API
 * @param url The endpoint url. E.g. `contact/`
 * @param httpMethod The HTTP method type. E.g. `post`
 * @param data The data to send to the endpoint
 * @returns {Promise<void>}
 */
export async function useAPI(url, httpMethod, data) {
  let query = JSON.stringify(data);
  let response = [];
  try {
    let options = {
      method: httpMethod,
      headers: {
        "Content-Type": "application/json",
      },
    };
    if (data !== null && data !== undefined) {
      options.body = query;
    }
    response = await fetch(`${process.env.POSTHOG_HOST}/${url}`, options);
    switch (response.status) {
      // HTTP: OK
      case 200:
        // Do nothing
        break;
      // HTTP Bad Request
      case 400:
      default:
        console.error(
          `PostHog: Received status ${response.status} from PostHog. Body follows.`,
        );
        let text = await response.text();
        console.error(text);
    }
  } catch (e) {
    console.error(`PostHog: Failure in useAPI`);
    Sentry.captureException(e);
    console.error(e);
  }
}

/**
 * Runs an individual search against the PostHog API
 * @param searchQuery The query to make
 * @param parameter The parameter to use in the URL. Defaults to `properties`.
 * @returns {Promise<*>} The parsed API response
 */
export async function individualSearch(searchQuery, parameter) {
  let query = parameter
    ? searchQuery
    : encodeURIComponent(JSON.stringify(searchQuery));
  let url = `https://app.posthog.com/api/projects/${process.env.POSTHOG_PROJECT_ID}/persons/?${parameter ? parameter : "properties"}=${query}`;

  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: "get",
        headers: { Authorization: `Bearer ${process.env.POSTHOG_API_TOKEN}` },
      });
    } catch (e) {
      console.error(
        `PostHog: Error when making API call (attempt ${attempt}/${maxRetries}): ${e}`,
      );
      if (attempt === maxRetries) {
        Sentry.captureException(e);
        return [];
      }
      continue;
    }

    if (!response.ok) {
      console.error(
        `PostHog: API returned status ${response.status} (attempt ${attempt}/${maxRetries})`,
      );
      if (attempt === maxRetries) {
        Sentry.captureException(
          new Error(
            `PostHog: API returned status ${response.status} after ${maxRetries} attempts`,
          ),
        );
        return [];
      }
      continue;
    }

    let data;
    try {
      data = await response.text();
    } catch (e) {
      console.error(
        `PostHog: Error reading response body (attempt ${attempt}/${maxRetries}): ${e}`,
      );
      if (attempt === maxRetries) {
        Sentry.captureException(e);
        return [];
      }
      continue;
    }

    try {
      return JSON.parse(data);
    } catch (e) {
      console.error(
        `PostHog: Failed to parse JSON (attempt ${attempt}/${maxRetries}): ${e}`,
      );
      console.error(`PostHog: JSON data was:\n${data}`);
      if (attempt === maxRetries) {
        Sentry.captureException(e);
        return [];
      }
    }
  }

  return [];
}

/**
 * Searches for a user based on a value and key.
 * @param key The key to search within
 * @param value The value to search for
 * @returns {Promise<*|null>} Matched users, null if none
 */
export async function searchByKey(key, value) {
  if (value !== null && value !== undefined) {
    /*
          TODO: Figure out how to do a case-insensitive search
          Ref: https://posthog.com/docs/api/persons#get-api-projects-project_id-persons
          One of their libraries has this: https://github.com/PostHog/posthog/blob/a074f9643fdc09419c8d8de3d7d036b7f8a1341c/rust/feature-flags/src/properties/property_models.rs#L5-L23
         */
    let query = [
      {
        key: key,
        value: value,
        operator: "exact",
        type: "person",
      },
    ];
    // TODO: Add sentry here
    let results = await individualSearch(query, null).catch((e) =>
      console.error(e),
    );
    if (
      typeof results.results === "undefined" ||
      results.results.length === undefined ||
      results.results.length === 0
    ) {
      return null;
    } else {
      return results;
    }
  } else {
    return null;
  }
}

/**
 * Searches PostHog for a Contact
 * @param contact The contact to search for
 * @returns {undefined|string} The id of the first matching PostHog Person, or `undefined` if none
 */
export async function searchForUser(contact) {
  // If contact doesn't have data to search with, return undefined
  if (
    contact.name === undefined &&
    contact.email === undefined &&
    contact.phone === undefined &&
    contact.alternatePhone === undefined &&
    contact.address === undefined
  ) {
    return undefined;
  }

  // This will store all found IDs that match (can store the same one multiple times)
  let potentialIDs = [];

  // Search all contact parts
  let results = await searchByKey("name", contact.name);
  if (results !== null) {
    for (let result of results.results) {
      potentialIDs.push(result["distinct_ids"][0]);
    }
  }
  results = await searchByKey("email", contact.email);
  if (results !== null) {
    for (let result of results.results) {
      potentialIDs.push(result["distinct_ids"][0]);
    }
  }
  results = await searchByKey("phone", contact.phone);
  if (results !== null) {
    for (let result of results.results) {
      potentialIDs.push(result["distinct_ids"][0]);
    }
  }
  results = await searchByKey("alternatePhone", contact.alternatePhone);
  if (results !== null) {
    for (let result of results.results) {
      potentialIDs.push(result["distinct_ids"][0]);
    }
  }
  results = await searchByKey("address", contact.address);
  if (results !== null) {
    for (let result of results.results) {
      potentialIDs.push(result["distinct_ids"][0]);
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
  let mostFrequent = Object.keys(counts).filter((k) => counts[k] === maxCount);

  return mostFrequent[0];
}

/**
 * Gets the data at an index of a place's address_components
 * @param place Place to find data for
 * @param addressComponentIndex Index of address_components
 * @param key Key to get value from
 * @returns {string} The data, or empty string
 */
export function getPlaceLocationPart(place, addressComponentIndex, key) {
  // Check that the index exists in address_components
  if (place[0].address_components.length > addressComponentIndex) {
    // Check if we should return long_name or short_name
    if (key in place[0].address_components[addressComponentIndex]) {
      return place[0].address_components[addressComponentIndex][key];
    } else {
      // Neither short_name nor long_name exist at index. Return empty string
      return "";
    }
  }
}

/**
 * Resolves an address to geo data via Google Maps for PostHog person properties
 * @param {string|null|undefined} address The address to resolve
 * @returns {Promise<object>} Geo properties object (empty if no address or lookup fails)
 */
async function resolveGeoData(address) {
  if (!address || address === "") {
    return {};
  }

  let place = await GoogleMaps.searchPlace(address);
  if (place === null || place === undefined || place.length === null) {
    console.error(`PostHog: No place found for ${address} on Google Maps.`);
    return {};
  }

  return {
    $geoip_city_name: getPlaceLocationPart(place, 2, "long_name"),
    $geoip_country_code: getPlaceLocationPart(place, 5, "short_name"),
    $geoip_country_name: getPlaceLocationPart(place, 5, "long_name"),
    $geoip_postal_code: getPlaceLocationPart(place, 6, "long_name"),
    $geoip_subdivision_1_name: getPlaceLocationPart(place, 3, "long_name"),
    $initial_geoip_city_name: getPlaceLocationPart(place, 2, "long_name"),
    $initial_geoip_country_code: getPlaceLocationPart(place, 5, "short_name"),
    $initial_geoip_country_name: getPlaceLocationPart(place, 5, "long_name"),
    $initial_geoip_postal_code: getPlaceLocationPart(place, 6, "long_name"),
    $initial_geoip_subdivision_1_name: getPlaceLocationPart(
      place,
      3,
      "long_name",
    ),
  };
}

/**
 * Logs the contact to PostHog, updating the client if they already exist.
 * Used for non-Jobber contacts (website forms, Google Ads leads, etc.)
 * that don't have a stable Jobber client ID.
 * @param contact The client to log to PostHog
 * @returns {Promise<string>} The ID of the client in PostHog
 */
export async function sendClientToPostHog(contact) {
  let clientData = await resolveGeoData(contact.address);

  // Search for the person in PostHog
  let id = crypto.randomBytes(16).toString("hex");
  let posthogPerson = await searchForUser(contact);

  // If this is a new person, add them to PostHog
  if (posthogPerson === undefined) {
    console.info(`PostHog: Adding ${contact.name} to PostHog`);
  } else {
    id = posthogPerson;
    console.info(`PostHog: Matched ${contact.name} to PostHog ID ${id}`);

    // Get the matched person in PostHog
    let fullPostHogPerson = await individualSearch(`${id}`, "distinct_id");
    if (
      fullPostHogPerson &&
      fullPostHogPerson.results &&
      fullPostHogPerson.results.length > 0
    ) {
      fullPostHogPerson = fullPostHogPerson.results[0];

      // If the person is the same as what we would set, don't send to PostHog. This cuts down on unnecessary events.
      let same = true;
      if (
        contact.name !== fullPostHogPerson.properties.name ||
        contact.phone !== fullPostHogPerson.properties.phone ||
        contact.alternatePhone !==
          fullPostHogPerson.properties.alternatePhone ||
        contact.email !== fullPostHogPerson.properties.email ||
        contact.address !== fullPostHogPerson.properties.address
      ) {
        same = false;
      }
      if (same) {
        return id;
      }
    } else {
      console.error(
        "PostHog: ERROR: Issue parsing the person. Details follow.",
      );
      console.info(`\tfullPostHogPerson:\t${fullPostHogPerson}`);
    }
  }

  // Identify the user to allow PostHog to display client details properly
  clientData.name = contact.name;
  clientData.phone = contact.phone;
  clientData.alternatePhone = contact.alternatePhone;
  clientData.email = contact.email;
  clientData.address = contact.address;
  clientData.latestContactSource = contact.type;
  let identifyData = {
    api_key: process.env.POSTHOG_TOKEN,
    distinct_id: id,
    event: "$identify",
    $set: clientData,
  };

  await useAPI("capture/", "post", identifyData);

  return id;
}

/**
 * Logs a contact to PostHog
 * @param contact The Contact that was parsed
 * @param originalMessage The message that was parsed into a contact.
 */
export async function logContact(contact, originalMessage) {
  let id = await sendClientToPostHog(contact);

  // Create an event for the person in PostHog
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "contact made",
    properties: {
      distinct_id: id,
      type: contact.type,
      message: contact.message,
      originalMessage: originalMessage,
      source: contact.source,
    },
  };
  await useAPI("capture/", "post", captureData);

  // Send all queued data to PostHog
}
events.on("posthog-log-contact", logContact);

/**
 * Logs a created client in Jobber to PostHog.
 * Uses the Jobber client ID as the distinct_id to guarantee a stable identity
 * and avoid duplicate persons from race conditions or search mismatches.
 * @param jobberClient The Jobber client object (with phones, emails, billingAddress, etc.)
 * @returns {Promise<string>} The Jobber client ID used as PostHog distinct_id
 */
export async function logClient(jobberClient) {
  let defaultEmail;
  if ("emails" in jobberClient) {
    for (let i = 0; i < jobberClient.emails.length; i++) {
      if (jobberClient.emails[i]["primary"]) {
        defaultEmail = jobberClient.emails[i].address;
      }
    }
  }

  let defaultPhone;
  if ("phones" in jobberClient) {
    if (jobberClient.phones.length > 0) {
      defaultPhone = jobberClient.phones[0].number;
      for (let i = 0; i < jobberClient.phones.length; i++) {
        if (jobberClient.phones[i]["primary"]) {
          defaultPhone = jobberClient.phones[i].number;
        }
      }
    }
  }

  let address = "";
  if (jobberClient["billingAddress"] !== null) {
    if ("street" in jobberClient["billingAddress"]) {
      address += `${jobberClient["billingAddress"]["street"]} `;
    }
    if ("city" in jobberClient["billingAddress"]) {
      address += `${jobberClient["billingAddress"]["city"]} `;
    }
    if ("province" in jobberClient["billingAddress"]) {
      address += `${jobberClient["billingAddress"]["province"]} `;
    }
    if ("postalCode" in jobberClient["billingAddress"]) {
      address += `${jobberClient["billingAddress"]["postalCode"]}`;
    }
  }

  let id = jobberClient.id;
  let clientData = await resolveGeoData(address !== "" ? address : null);

  clientData.name = jobberClient.name;
  clientData.phone = defaultPhone || null;
  clientData.email = defaultEmail || null;
  clientData.address = address !== "" ? address : null;

  let identifyData = {
    api_key: process.env.POSTHOG_TOKEN,
    distinct_id: id,
    event: "$identify",
    $set: clientData,
  };

  await useAPI("capture/", "post", identifyData);

  // Search for old duplicate persons (created with random hex IDs) and merge them
  try {
    let duplicateIds = new Set();

    let searchFields = [
      ["name", jobberClient.name],
      ["email", defaultEmail],
      ["phone", defaultPhone],
    ];

    for (let [key, value] of searchFields) {
      let results = await searchByKey(key, value);
      if (results !== null) {
        for (let result of results.results) {
          for (let distinctId of result["distinct_ids"]) {
            if (distinctId !== id) {
              duplicateIds.add(distinctId);
            }
          }
        }
      }
    }

    for (let duplicateId of duplicateIds) {
      console.info(
        `PostHog: Merging duplicate person ${duplicateId} into ${id}`,
      );
      await useAPI("capture/", "post", {
        api_key: process.env.POSTHOG_TOKEN,
        event: "$merge_dangerously",
        distinct_id: id,
        properties: {
          alias: duplicateId,
        },
      });
    }
  } catch (e) {
    Sentry.captureException(e);
    console.error("PostHog: Error merging duplicate persons:", e);
  }

  return id;
}

/**
 * Logs a user in Jobber to PostHog
 * @param jobberUser The user in Jobber
 */
export async function logEmployee(jobberUser) {
  // Identify the user to allow PostHog to display employee details properly
  let userData = {
    name: jobberUser.name.full,
    phone: jobberUser.phone.friendly,
    email: jobberUser.email.raw,
    uuid: jobberUser.uuid,
    id: jobberUser.id,
  };

  let identifyData = {
    api_key: process.env.POSTHOG_TOKEN,
    distinct_id: jobberUser.uuid,
    event: "$identify",
    $set: userData,
  };

  await useAPI("capture/", "post", identifyData);

  return jobberUser.uuid;
}

/**
 * Logs a created Invoice in Jobber to PostHog
 * @param jobberInvoice The Invoice that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logInvoice(jobberInvoice, clientID) {
  // Create an event for invoice in PostHog
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "invoice made",
    properties: {
      distinct_id: clientID,
      subject: jobberInvoice.subject,
      invoiceNumber: jobberInvoice.invoiceNumber,
      depositAmount: jobberInvoice["amounts"].depositAmount,
      discountAmount: jobberInvoice["amounts"].discountAmount,
      invoiceBalance: jobberInvoice["amounts"].invoiceBalance,
      paymentsTotal: jobberInvoice["amounts"].paymentsTotal,
      subtotal: jobberInvoice["amounts"].subtotal,
      total: jobberInvoice["amounts"].total,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a created quote in Jobber to PostHog
 * @param jobberQuote The quote that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logQuote(jobberQuote, clientID) {
  // Create an event for quote in PostHog
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "quote made",
    properties: {
      distinct_id: clientID,
      quoteNumber: jobberQuote.quoteNumber,
      quoteStatus: jobberQuote.quoteStatus,
      depositAmount: jobberQuote["amounts"].depositAmount,
      discountAmount: jobberQuote["amounts"].discountAmount,
      outstandingDepositAmount: jobberQuote["amounts"].outstandingDepositAmount,
      subtotal: jobberQuote["amounts"].subtotal,
      total: jobberQuote["amounts"].total,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a created quote in Jobber to PostHog
 * @param jobberQuote The quote that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logQuoteUpdate(jobberQuote, clientID) {
  // Check if the quote is not accepted
  if (jobberQuote.quoteStatus === "approved") {
    // Create an event for quote in PostHog
    let captureData = {
      api_key: process.env.POSTHOG_TOKEN,
      event: "quote accepted",
      properties: {
        distinct_id: clientID,
        quoteNumber: jobberQuote.quoteNumber,
        quoteStatus: jobberQuote.quoteStatus,
        depositAmount: jobberQuote["amounts"].depositAmount,
        discountAmount: jobberQuote["amounts"].discountAmount,
        outstandingDepositAmount:
          jobberQuote["amounts"].outstandingDepositAmount,
        subtotal: jobberQuote["amounts"].subtotal,
        total: jobberQuote["amounts"].total,
      },
    };
    await useAPI("capture/", "post", captureData);
  }
}

/**
 * Logs a created job in Jobber to PostHog
 * @param jobberJob The job that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logJob(jobberJob, clientID) {
  // Create an event for job in PostHog
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "job made",
    properties: {
      distinct_id: clientID,
      jobNumber: jobberJob.jobNumber,
      jobStatus: jobberJob.jobStatus,
      title: jobberJob.title,
      total: jobberJob.total,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs an edited job in Jobber to PostHog
 * @param jobberJob The job that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logJobUpdate(jobberJob, clientID) {
  // Create an event for job in PostHog
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "job updated",
    properties: {
      distinct_id: clientID,
      jobNumber: jobberJob.jobNumber,
      jobStatus: jobberJob.jobStatus,
      title: jobberJob.title,
      total: jobberJob.total,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a created payment in Jobber to PostHog
 * @param jobberPayment The payment that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logPayment(jobberPayment, clientID) {
  // Create an event for payment in PostHog
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "payment made",
    properties: {
      distinct_id: clientID,
      adjustmentType: jobberPayment.adjustmentType,
      amount: jobberPayment.amount,
      details: jobberPayment.details,
      paymentOrigin: jobberPayment.paymentOrigin,
      paymentType: jobberPayment.paymentType,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a created payment in Jobber to PostHog
 * @param jobberPayment The payment that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logPaymentUpdate(jobberPayment, clientID) {
  // Create an event for payment in PostHog
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "payment updated",
    properties: {
      distinct_id: clientID,
      adjustmentType: jobberPayment.adjustmentType,
      amount: jobberPayment.amount,
      details: jobberPayment.details,
      paymentOrigin: jobberPayment.paymentOrigin,
      paymentType: jobberPayment.paymentType,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a created payout in Jobber to PostHog
 * @param jobberPayout The payout that was parsed
 */
export async function logPayout(jobberPayout) {
  // Create an event for payout in PostHog
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "payout made",
    properties: {
      distinct_id: "jobber-service",
      arrivalDate: jobberPayout.arrivalDate,
      created: jobberPayout.created,
      currency: jobberPayout.currency,
      feeAmount: jobberPayout.feeAmount,
      grossAmount: jobberPayout.grossAmount,
      id: jobberPayout.id,
      identifier: jobberPayout.identifier,
      netAmount: jobberPayout.netAmount,
      payoutMethod: jobberPayout.payoutMethod,
      status: jobberPayout.status,
      type: jobberPayout.type,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a payout update in Jobber to PostHog
 * @param jobberPayout The payout that was parsed
 */
export async function logPayoutUpdate(jobberPayout) {
  // Create an event for payout in PostHog
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "payout updated",
    properties: {
      distinct_id: "jobber-service",
      arrivalDate: jobberPayout.arrivalDate,
      created: jobberPayout.created,
      currency: jobberPayout.currency,
      feeAmount: jobberPayout.feeAmount,
      grossAmount: jobberPayout.grossAmount,
      id: jobberPayout.id,
      identifier: jobberPayout.identifier,
      netAmount: jobberPayout.netAmount,
      payoutMethod: jobberPayout.payoutMethod,
      status: jobberPayout.status,
      type: jobberPayout.type,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a property create in Jobber to PostHog
 * @param jobberProperty The property that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logProperty(jobberProperty, clientID) {
  // Create an event for property in PostHog
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "property made",
    properties: {
      distinct_id: clientID,
      isBillingAddress: jobberProperty.isBillingAddress,
      jobberWebUri: jobberProperty.jobberWebUri,
      routingOrder: jobberProperty.routingOrder,
      taxRate: jobberProperty.taxRate,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a property update in Jobber to PostHog
 * @param jobberProperty The property that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logPropertyUpdate(jobberProperty, clientID) {
  // Create an event for property in PostHog
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "property updated",
    properties: {
      distinct_id: clientID,
      isBillingAddress: jobberProperty.isBillingAddress,
      jobberWebUri: jobberProperty.jobberWebUri,
      routingOrder: jobberProperty.routingOrder,
      taxRate: jobberProperty.taxRate,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a visit create in Jobber to PostHog
 * @param jobberVisit The visit that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logVisit(jobberVisit, clientID) {
  // Create an event for visit in PostHog

  let name;
  if (jobberVisit.createdBy !== null && jobberVisit.createdBy !== undefined) {
    if (
      jobberVisit.createdBy.name !== null &&
      jobberVisit.createdBy.name !== undefined
    ) {
      name = jobberVisit.createdBy.name.full;
    }
  }

  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "visit made",
    properties: {
      distinct_id: clientID,
      allDay: jobberVisit.allDay,
      completedAt: jobberVisit.completedAt,
      createdAt: jobberVisit.createdAt,
      createdBy: name,
      duration: jobberVisit.duration,
      endAt: jobberVisit.endAt,
      instructions: jobberVisit.instructions,
      isComplete: jobberVisit.isComplete,
      isDefaultTitle: jobberVisit.isDefaultTitle,
      isLastScheduledVisit: jobberVisit.isLastScheduledVisit,
      overrideOrder: jobberVisit.overrideOrder,
      startAt: jobberVisit.startAt,
      title: jobberVisit.title,
      visitStatus: jobberVisit.visitStatus,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a visit update in Jobber to PostHog
 * @param jobberVisit The visit that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logVisitUpdate(jobberVisit, clientID) {
  // Create an event for visit in PostHog

  let name;
  if (jobberVisit.createdBy !== null && jobberVisit.createdBy !== undefined) {
    if (
      jobberVisit.createdBy.name !== null &&
      jobberVisit.createdBy.name !== undefined
    ) {
      name = jobberVisit.createdBy.name.full;
    }
  }

  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "visit updated",
    properties: {
      distinct_id: clientID,
      allDay: jobberVisit.allDay,
      completedAt: jobberVisit.completedAt,
      createdAt: jobberVisit.createdAt,
      createdBy: name,
      duration: jobberVisit.duration,
      endAt: jobberVisit.endAt,
      instructions: jobberVisit.instructions,
      isComplete: jobberVisit.isComplete,
      isDefaultTitle: jobberVisit.isDefaultTitle,
      isLastScheduledVisit: jobberVisit.isLastScheduledVisit,
      overrideOrder: jobberVisit.overrideOrder,
      startAt: jobberVisit.startAt,
      title: jobberVisit.title,
      visitStatus: jobberVisit.visitStatus,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a visit update in Jobber to PostHog
 * @param jobberVisit The visit that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logVisitComplete(jobberVisit, clientID) {
  // Create an event for visit in PostHog

  let name;
  if (jobberVisit.createdBy !== null && jobberVisit.createdBy !== undefined) {
    if (
      jobberVisit.createdBy.name !== null &&
      jobberVisit.createdBy.name !== undefined
    ) {
      name = jobberVisit.createdBy.name.full;
    }
  }

  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "visit completed",
    properties: {
      distinct_id: clientID,
      allDay: jobberVisit.allDay,
      completedAt: jobberVisit.completedAt,
      createdAt: jobberVisit.createdAt,
      createdBy: name,
      duration: jobberVisit.duration,
      endAt: jobberVisit.endAt,
      instructions: jobberVisit.instructions,
      isComplete: jobberVisit.isComplete,
      isDefaultTitle: jobberVisit.isDefaultTitle,
      isLastScheduledVisit: jobberVisit.isLastScheduledVisit,
      overrideOrder: jobberVisit.overrideOrder,
      startAt: jobberVisit.startAt,
      title: jobberVisit.title,
      visitStatus: jobberVisit.visitStatus,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs an expense creation in Jobber to PostHog
 * @param jobberExpense The expense that was parsed
 * @param userID The user ID to use for the event
 */
export async function logExpenseCreate(jobberExpense, userID) {
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "expense created",
    properties: {
      distinct_id: userID,
      createdAt: jobberExpense.createdAt,
      date: jobberExpense.date,
      description: jobberExpense.description,
      id: jobberExpense.id,
      linkedJob: jobberExpense.linkedJob ? jobberExpense.linkedJob.id : null,
      paidBy: jobberExpense.paidBy ? jobberExpense.paidBy.id : null,
      reimbursableTo: jobberExpense.reimbursableTo
        ? jobberExpense.reimbursableTo.id
        : null,
      title: jobberExpense.title,
      total: jobberExpense.total,
      updatedAt: jobberExpense.updatedAt,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs an expense update in Jobber to PostHog
 * @param jobberExpense The expense that was parsed
 * @param userID The user ID to use for the event
 */
export async function logExpenseUpdate(jobberExpense, userID) {
  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "expense updated",
    properties: {
      distinct_id: userID,
      createdAt: jobberExpense.createdAt,
      date: jobberExpense.date,
      description: jobberExpense.description,
      id: jobberExpense.id,
      linkedJob: jobberExpense.linkedJob ? jobberExpense.linkedJob.id : null,
      paidBy: jobberExpense.paidBy ? jobberExpense.paidBy.id : null,
      reimbursableTo: jobberExpense.reimbursableTo
        ? jobberExpense.reimbursableTo.id
        : null,
      title: jobberExpense.title,
      total: jobberExpense.total,
      updatedAt: jobberExpense.updatedAt,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a request update in Jobber to PostHog
 * @param jobberRequest The request that was parsed
 * @param clientID The client ID to use for the event
 */
export async function logRequestUpdate(jobberRequest, clientID) {
  // Create an event for request in PostHog

  let name;
  if (
    jobberRequest.createdBy !== null &&
    jobberRequest.createdBy !== undefined
  ) {
    if (
      jobberRequest.createdBy.name !== null &&
      jobberRequest.createdBy.name !== undefined
    ) {
      name = jobberRequest.createdBy.name.full;
    }
  }

  let address = `${jobberRequest.client.billingAddress.street}, ${jobberRequest.client.billingAddress.city} ${jobberRequest.client.billingAddress.province}, ${jobberRequest.client.billingAddress.postalCode}`;
  if (jobberRequest.property !== null && jobberRequest.property !== undefined) {
    if (
      jobberRequest.property.address !== null &&
      jobberRequest.property.address !== undefined
    ) {
      address = `${jobberRequest.property.address.street}, ${jobberRequest.property.address.city} ${jobberRequest.property.address.province}, ${jobberRequest.property.address.postalCode}`;
    }
  }

  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "request updated",
    properties: {
      distinct_id: clientID,
      companyName: jobberRequest.companyName,
      contactName: jobberRequest.contactName,
      createdAt: jobberRequest.createdAt,
      email: jobberRequest.email,
      jobberWebUri: jobberRequest.jobberWebUri,
      phone: jobberRequest.phone,
      address: jobberRequest.address,
      referringClient: jobberRequest.referringClient
        ? jobberRequest.referringClient.name
        : null,
      requestStatus: jobberRequest.requestStatus,
      source: jobberRequest.source,
      title: jobberRequest.title,
      updatedAt: jobberRequest.updatedAt,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs an inbound call to PostHog
 * @param {object} callData
 * @param {string} callData.from - Customer phone number
 * @param {string} callData.to - Twilio number that was called
 * @param {string} callData.routedTo - Employee number or fallback the call was routed to
 * @param {string|null} callData.assignedEmployee - Slack user ID of assigned employee
 * @param {string|null} callData.assignedEmployeeName - Name of assigned employee
 */
export async function logInboundCall(callData) {
  let id = await sendClientToPostHog(
    new Contact(null, null, callData.from, null, null, null, null),
  );

  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "inbound call",
    properties: {
      distinct_id: id,
      from: callData.from,
      to: callData.to,
      routedTo: callData.routedTo,
      assignedEmployee: callData.assignedEmployee,
      assignedEmployeeName: callData.assignedEmployeeName,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a missed call to PostHog
 * @param {object} callData
 * @param {string} callData.from - Customer phone number
 * @param {string} callData.to - Twilio number that was called
 * @param {string} callData.reason - Why the call was missed
 */
export async function logMissedCall(callData) {
  let id = await sendClientToPostHog(
    new Contact(null, null, callData.from, null, null, null, null),
  );

  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "missed call",
    properties: {
      distinct_id: id,
      from: callData.from,
      to: callData.to,
      reason: callData.reason,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a voicemail to PostHog
 * @param {object} callData
 * @param {string} callData.from - Customer phone number
 * @param {string} callData.to - Twilio number that was called
 * @param {number} callData.duration - Voicemail duration in seconds
 */
export async function logVoicemail(callData) {
  let id = await sendClientToPostHog(
    new Contact(null, null, callData.from, null, null, null, null),
  );

  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "voicemail left",
    properties: {
      distinct_id: id,
      from: callData.from,
      to: callData.to,
      duration: callData.duration,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs an outbound call to PostHog
 * @param {object} callData
 * @param {string} callData.customerPhone - Customer phone number
 * @param {string} callData.employeePhone - Employee phone number
 * @param {string} callData.twilioNumber - Twilio number used for the call
 * @param {string} callData.callSid - Twilio call SID
 */
export async function logOutboundCall(callData) {
  let id = await sendClientToPostHog(
    new Contact(null, null, callData.customerPhone, null, null, null, null),
  );

  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "outbound call",
    properties: {
      distinct_id: id,
      customerPhone: callData.customerPhone,
      employeePhone: callData.employeePhone,
      twilioNumber: callData.twilioNumber,
      callSid: callData.callSid,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs an inbound SMS to PostHog
 * @param {object} smsData
 * @param {string} smsData.from - Customer phone number
 * @param {string} smsData.to - Twilio number that received the message
 * @param {string|null} smsData.body - Message body
 * @param {number} smsData.mediaCount - Number of media attachments
 * @param {string|null} smsData.assignedEmployee - Slack user ID of assigned employee
 */
export async function logInboundSms(smsData) {
  let id = await sendClientToPostHog(
    new Contact(null, null, smsData.from, null, null, null, null),
  );

  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "inbound sms",
    properties: {
      distinct_id: id,
      from: smsData.from,
      to: smsData.to,
      body: smsData.body,
      mediaCount: smsData.mediaCount,
      assignedEmployee: smsData.assignedEmployee,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs an outbound SMS to PostHog
 * @param {object} smsData
 * @param {string} smsData.customerPhone - Customer phone number
 * @param {string} smsData.employeePhone - Employee phone number
 * @param {string} smsData.twilioNumber - Twilio number used
 * @param {string|null} smsData.body - Message body
 * @param {boolean} smsData.hasMedia - Whether media was attached
 */
export async function logOutboundSms(smsData) {
  let id = await sendClientToPostHog(
    new Contact(null, null, smsData.customerPhone, null, null, null, null),
  );

  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "outbound sms",
    properties: {
      distinct_id: id,
      customerPhone: smsData.customerPhone,
      employeePhone: smsData.employeePhone,
      twilioNumber: smsData.twilioNumber,
      body: smsData.body,
      hasMedia: smsData.hasMedia,
    },
  };
  await useAPI("capture/", "post", captureData);
}

/**
 * Logs a call recording completion to PostHog
 * @param {object} recordingData
 * @param {string} recordingData.customerPhone - Customer phone number
 * @param {string} recordingData.ourNumber - Twilio number used
 * @param {string} recordingData.direction - Call direction (inbound/outbound)
 * @param {number} recordingData.duration - Recording duration in seconds
 * @param {string} recordingData.callSid - Twilio call SID
 */
export async function logCallRecording(recordingData) {
  let id = await sendClientToPostHog(
    new Contact(
      null,
      null,
      recordingData.customerPhone,
      null,
      null,
      null,
      null,
    ),
  );

  let captureData = {
    api_key: process.env.POSTHOG_TOKEN,
    event: "call recorded",
    properties: {
      distinct_id: id,
      customerPhone: recordingData.customerPhone,
      ourNumber: recordingData.ourNumber,
      direction: recordingData.direction,
      duration: recordingData.duration,
      callSid: recordingData.callSid,
    },
  };
  await useAPI("capture/", "post", captureData);
}
