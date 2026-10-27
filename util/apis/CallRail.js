import crypto from "crypto";
import fetch from "node-fetch";
import { toE164 } from "../DataUtilities.js";
import * as Sentry from "@sentry/node";

const CALLRAIL_API_KEY = process.env.CALLRAIL_API_KEY;
const CALLRAIL_ACCOUNT_ID = process.env.CALLRAIL_ACCOUNT_ID;
const CALLRAIL_SIGNING_KEY = process.env.CALLRAIL_SIGNING_KEY;
const BASE_URL = `https://api.callrail.com/v3/a/${CALLRAIL_ACCOUNT_ID}`;

function isApiDisabled() {
  return process.env.CALLRAIL_API_DISABLED === "TRUE";
}

/**
 * Verifies a CallRail webhook signature using HMAC-SHA1.
 * @param {import("express").Request & {rawBody?: string}} req
 * @returns {boolean}
 */
export function verifyWebhook(req) {
  if (process.env.DEBUG === "TRUE") {
    return true;
  }

  if (!CALLRAIL_SIGNING_KEY) {
    console.warn("CallRail: No signing key configured, skipping verification");
    return true;
  }

  const signature = req.headers["signature"];
  if (!signature) {
    console.warn("CallRail: Webhook missing Signature header");
    return false;
  }

  const body = req.rawBody || req.body;
  const hmac = crypto.createHmac("sha1", CALLRAIL_SIGNING_KEY);
  hmac.update(typeof body === "string" ? body : JSON.stringify(body));
  const computed = hmac.digest("base64");

  return computed === signature;
}

/**
 * Search CallRail for calls matching the given phone number, from any date
 * (without date_range, CallRail only searches the last 7 days)
 * @param {string} phoneE164 Phone number in E.164 format
 * @returns {Promise<object[]>} All matching calls (empty array if none)
 */
export async function searchCallByPhone(phoneE164) {
  if (isApiDisabled()) return [];

  let response = await fetch(
    `${BASE_URL}/calls.json?search=${encodeURIComponent(phoneE164)}&date_range=all_time&per_page=250&fields=source,source_name,gclid,value,lead_status,tags,note`,
    {
      headers: {
        Authorization: `Token token="${CALLRAIL_API_KEY}"`,
      },
    },
  );

  if (!response.ok) {
    let body = await response.text().catch(() => "");
    throw new Error(
      `CallRail search failed: ${response.status} ${response.statusText}: ${body}`,
    );
  }

  let data = await response.json();
  return data.calls || [];
}

/**
 * Update a CallRail call with lead status, value, note, and tags
 * @param {string} callId The CallRail call ID
 * @param {object} params
 * @param {number} params.value The monetary value
 * @param {string} params.note A note to attach
 * @returns {Promise<object>} The updated call
 */
export async function updateCall(
  callId,
  { value, note, customer_name, lead_status },
) {
  if (isApiDisabled()) return null;

  const maxRetries = 3;

  let payload = {
    customer_name: customer_name,
    value: String(value),
    note: note,
    tags: ["invoice-paid"],
    append_tags: true,
  };
  if (lead_status) {
    payload.lead_status = lead_status;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let response = await fetch(`${BASE_URL}/calls/${callId}.json`, {
      method: "PUT",
      headers: {
        Authorization: `Token token="${CALLRAIL_API_KEY}"`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return await response.json();
    }

    let body = await response.text().catch(() => "");

    // Retry on 5xx errors
    if (response.status >= 500 && attempt < maxRetries) {
      let delay = 1000 * Math.pow(2, attempt - 1);
      console.warn(
        `CallRail: Update failed with ${response.status} (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms: ${body}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    throw new Error(
      `CallRail update failed: ${response.status} ${response.statusText}: ${body}`,
    );
  }
}

/**
 * Search CallRail for SMS threads matching the given phone number
 * @param {string} phoneE164 Phone number in E.164 format
 * @returns {Promise<object[]>} All matching SMS threads (empty array if none)
 */
export async function searchSMSByPhone(phoneE164) {
  if (isApiDisabled()) return [];

  let response = await fetch(
    `${BASE_URL}/sms-threads.json?search=${encodeURIComponent(phoneE164)}&fields=last_message_at,value,lead_qualification,tags`,
    {
      headers: {
        Authorization: `Token token="${CALLRAIL_API_KEY}"`,
      },
    },
  );

  if (!response.ok) {
    let body = await response.text().catch(() => "");
    throw new Error(
      `CallRail SMS thread search failed: ${response.status} ${response.statusText}: ${body}`,
    );
  }

  let data = await response.json();
  return data.sms_threads || [];
}

/**
 * Update a CallRail SMS thread with lead qualification, value, notes, and tags
 * @param {string} threadId The SMS thread ID
 * @param {object} params
 * @param {string} params.value The monetary value
 * @param {string} params.notes Notes to attach
 * @param {string|null} params.lead_qualification "good_lead", "not_a_lead", or null
 * @returns {Promise<object>} The updated SMS thread
 */
export async function updateSMSThread(
  threadId,
  { value, notes, lead_qualification },
) {
  if (isApiDisabled()) return null;

  const maxRetries = 3;

  let payload = {
    value: String(value),
    notes: notes,
    tags: ["invoice-paid"],
    append_tags: true,
  };
  if (lead_qualification) {
    payload.lead_qualification = lead_qualification;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let response = await fetch(`${BASE_URL}/sms-threads/${threadId}.json`, {
      method: "PUT",
      headers: {
        Authorization: `Token token="${CALLRAIL_API_KEY}"`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return await response.json();
    }

    let body = await response.text().catch(() => "");

    if (response.status >= 500 && attempt < maxRetries) {
      let delay = 1000 * Math.pow(2, attempt - 1);
      console.warn(
        `CallRail: SMS thread update failed with ${response.status} (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms: ${body}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    throw new Error(
      `CallRail SMS thread update failed: ${response.status} ${response.statusText}: ${body}`,
    );
  }
}

/**
 * Get the marketing source and GCLID of the most recent CallRail call for a phone number
 * @param {string} phone Raw phone number (will be converted to E.164)
 * @returns {Promise<{source: string|null, gclid: string|null}>}
 */
export async function getCallDetails(phone) {
  if (isApiDisabled()) return { source: null, gclid: null };

  let e164 = toE164(phone);
  if (!e164) return { source: null, gclid: null };

  try {
    // Check calls first
    let calls = await searchCallByPhone(e164);
    if (calls.length > 0) {
      let call = calls.sort(
        (a, b) => new Date(b.start_time) - new Date(a.start_time),
      )[0];
      if (call.source || call.gclid) {
        return { source: call.source || null, gclid: call.gclid || null };
      }
    }

    // Fall back to SMS threads (no GCLID available on SMS)
    let threads = await searchSMSByPhone(e164);
    if (threads.length > 0) {
      let sms = threads.sort(
        (a, b) => new Date(b.last_message_at) - new Date(a.last_message_at),
      )[0];
      if (sms.source) return { source: sms.source, gclid: null };
    }

    return { source: null, gclid: null };
  } catch (e) {
    console.warn("CallRail: Details lookup failed:", e.message);
    return { source: null, gclid: null };
  }
}

/**
 * Lists all active CallRail trackers for the account.
 * @returns {Promise<object[]>} Array of tracker objects
 */
export async function listTrackers() {
  if (isApiDisabled()) return [];

  let response = await fetch(`${BASE_URL}/trackers.json?status=active`, {
    headers: {
      Authorization: `Token token="${CALLRAIL_API_KEY}"`,
    },
  });

  if (!response.ok) {
    let body = await response.text().catch(() => "");
    throw new Error(
      `CallRail tracker list failed: ${response.status} ${response.statusText}: ${body}`,
    );
  }

  let data = await response.json();
  return data.trackers || [];
}

/**
 * Updates the destination number for all active CallRail trackers.
 * @param {string} newNumber The new destination phone number (E.164 format)
 * @returns {Promise<number>} The number of trackers updated
 */
export async function updateAllTrackerDestinations(newNumber) {
  if (isApiDisabled()) return 0;

  let trackers = await listTrackers();
  let updated = 0;

  for (let tracker of trackers) {
    try {
      let response = await fetch(`${BASE_URL}/trackers/${tracker.id}.json`, {
        method: "PUT",
        headers: {
          Authorization: `Token token="${CALLRAIL_API_KEY}"`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          call_flow: {
            destination_number: newNumber,
          },
        }),
      });

      if (response.ok) {
        console.log(
          `CallRail: Updated tracker ${tracker.name} (${tracker.id}) destination to ${newNumber}`,
        );
        updated++;
      } else {
        let body = await response.text().catch(() => "");
        console.error(
          `CallRail: Failed to update tracker ${tracker.id}: ${response.status} ${body}`,
        );
      }
    } catch (e) {
      Sentry.captureException(e);
      console.error(`CallRail: Error updating tracker ${tracker.id}:`, e);
    }
  }

  console.log(
    `CallRail: Updated ${updated}/${trackers.length} tracker destination(s) to ${newNumber}`,
  );
  return updated;
}

/**
 * Fetches CallRail calls that have both a value and a GCLID,
 * paginating through all results. Used for backfilling Google Ads conversions.
 * @param {number} [days=55] How many days back to list (Google Ads only takes
 *   adjustments for 55 days; without a start date CallRail lists only 7)
 * @returns {Promise<Array<{id: string, value: string, gclid: string, start_time: string}>>}
 */
export async function listCallsWithValueAndGclid(days = 55) {
  if (isApiDisabled()) return [];

  let allCalls = [];
  let page = 1;
  let totalPages = 1;
  let startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  while (page <= totalPages) {
    let response = await fetch(
      `${BASE_URL}/calls.json?fields=value,gclid&per_page=250&page=${page}&start_date=${startDate}`,
      {
        headers: {
          Authorization: `Token token="${CALLRAIL_API_KEY}"`,
        },
      },
    );

    if (!response.ok) {
      let body = await response.text().catch(() => "");
      throw new Error(
        `CallRail call list failed: ${response.status} ${response.statusText}: ${body}`,
      );
    }

    let data = await response.json();
    totalPages = data.total_pages || 1;

    for (let call of data.calls || []) {
      let value = call.value ? parseFloat(call.value) : 0;
      if (value > 0 && call.gclid) {
        allCalls.push(call);
      }
    }

    page++;
  }

  console.log(
    `CallRail: Found ${allCalls.length} call(s) with value and GCLID across ${totalPages} page(s)`,
  );
  return allCalls;
}
