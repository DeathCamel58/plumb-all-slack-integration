import fetch from "node-fetch";
import events from "../events.js";
import prisma from "../prismaClient.js";
import { toE164 } from "../DataUtilities.js";
import * as PostHog from "./PostHog.js";
import * as Sentry from "@sentry/node";

const CALLRAIL_API_KEY = process.env.CALLRAIL_API_KEY;
const CALLRAIL_ACCOUNT_ID = process.env.CALLRAIL_ACCOUNT_ID;
const BASE_URL = `https://api.callrail.com/v3/a/${CALLRAIL_ACCOUNT_ID}`;

/**
 * Search CallRail for calls matching the given phone number
 * @param {string} phoneE164 Phone number in E.164 format
 * @returns {Promise<object[]>} All matching calls (empty array if none)
 */
async function searchCallByPhone(phoneE164) {
  let response = await fetch(
    `${BASE_URL}/calls.json?search=${encodeURIComponent(phoneE164)}&fields=source`,
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
async function updateCall(callId, { value, note, customer_name, lead_status }) {
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
async function searchSMSByPhone(phoneE164) {
  let response = await fetch(
    `${BASE_URL}/sms-threads.json?search=${encodeURIComponent(phoneE164)}&fields=last_message_at`,
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
async function updateSMSThread(threadId, { value, notes, lead_qualification }) {
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
 * Handle first invoice payment: report conversion to CallRail
 * @param {object} payment The Jobber payment record (with enriched client)
 * @param {object} invoice The Jobber invoice data
 */
async function handleFirstInvoicePayment(payment, invoice) {
  try {
    if (!invoice) {
      return;
    }

    // Check if this is the client's first invoice
    let invoiceCount = await prisma.invoice.count({
      where: { clientId: payment.client.id },
    });
    if (invoiceCount > 1) {
      return;
    }

    // Collect all unique phone numbers from Jobber client + PostHog person
    let phoneSet = new Set();

    // Add Jobber client phones
    let phones = payment.client.phones;
    if (phones && phones.length > 0) {
      for (let phoneEntry of phones) {
        let e164 = toE164(phoneEntry.number);
        if (e164) phoneSet.add(e164);
      }
    }

    // Also check PostHog for additional phone numbers (e.g. the calling number
    // from Twilio that may differ from the Jobber callback number).
    // Uses the Jobber client ID as the distinct_id for a direct lookup.
    try {
      let posthogResult = await PostHog.individualSearch(
        payment.client.id,
        "distinct_id",
      );
      if (posthogResult?.results?.length > 0) {
        let props = posthogResult.results[0].properties || {};
        if (props.phone) {
          let e164 = toE164(props.phone);
          if (e164) phoneSet.add(e164);
        }
        if (props.alternatePhone) {
          let e164 = toE164(props.alternatePhone);
          if (e164) phoneSet.add(e164);
        }
        if (Array.isArray(props.phones)) {
          for (let p of props.phones) {
            let e164 = toE164(p);
            if (e164) phoneSet.add(e164);
          }
        }
      }
    } catch (e) {
      // PostHog lookup is best-effort; don't block on failure
      console.warn("CallRail: PostHog phone lookup failed:", e.message);
    }

    if (phoneSet.size === 0) {
      Sentry.captureMessage("CallRail: Client has no phone numbers", {
        level: "warning",
        extra: { clientId: payment.client.id },
      });
      console.warn(
        "CallRail: Client has no phone numbers, skipping",
        payment.client.id,
      );
      return;
    }

    // Search CallRail with each phone number, collecting all unqualified calls
    let unqualifiedCalls = [];
    for (let phoneE164 of phoneSet) {
      let calls = await searchCallByPhone(phoneE164);
      for (let candidate of calls) {
        if (candidate.value && parseFloat(candidate.value) > 0) {
          console.log(
            `CallRail: Call ${candidate.id} already qualified (value: ${candidate.value}), skipping`,
          );
          continue;
        }
        unqualifiedCalls.push(candidate);
      }
    }

    let conversionNote = `Client: ${payment.client.jobberWebUri}\nInvoice: ${invoice.jobberWebUri}`;

    // Try calls first
    if (unqualifiedCalls.length > 0) {
      let call = unqualifiedCalls.sort(
        (a, b) => new Date(b.start_time) - new Date(a.start_time),
      )[0];
      console.log(`CallRail: Selected most recent unqualified call ${call.id}`);

      let leadStatus =
        call.lead_status === "previously_marked_good_lead" ? null : "good_lead";
      await updateCall(call.id, {
        value: invoice.amounts.total,
        note: conversionNote,
        customer_name: payment.client.name,
        lead_status: leadStatus,
      });

      console.log(
        "CallRail: Reported first invoice conversion for call",
        call.id,
      );
      return;
    }

    // No unqualified calls — fall back to SMS threads
    console.log("CallRail: No unqualified calls found, searching SMS threads");

    let unqualifiedSMS = [];
    for (let phoneE164 of phoneSet) {
      let threads = await searchSMSByPhone(phoneE164);
      for (let candidate of threads) {
        if (candidate.value && parseFloat(candidate.value) > 0) {
          console.log(
            `CallRail: SMS thread ${candidate.id} already qualified (value: ${candidate.value}), skipping`,
          );
          continue;
        }
        unqualifiedSMS.push(candidate);
      }
    }

    if (unqualifiedSMS.length === 0) {
      console.log(
        "CallRail: No matching unqualified call or SMS found for any phone",
        [...phoneSet],
      );
      return;
    }

    let sms = unqualifiedSMS.sort(
      (a, b) => new Date(b.last_message_at) - new Date(a.last_message_at),
    )[0];
    console.log(
      `CallRail: Selected most recent unqualified SMS thread ${sms.id}`,
    );

    let leadQualification =
      sms.lead_qualification === "good_lead" ? null : "good_lead";
    await updateSMSThread(sms.id, {
      value: invoice.amounts.total,
      notes: conversionNote,
      lead_qualification: leadQualification,
    });

    console.log(
      "CallRail: Reported first invoice conversion for SMS thread",
      sms.id,
    );
  } catch (e) {
    Sentry.captureException(e);
    console.error("CallRail: Error handling first invoice payment:", e);
  }
}

events.on("callrail-FIRST_INVOICE_PAYMENT", handleFirstInvoicePayment);

/**
 * Get the marketing source of the most recent CallRail call for a phone number
 * @param {string} phone Raw phone number (will be converted to E.164)
 * @returns {Promise<string|null>} The call's source (e.g. "Google Ads") or null
 */
export async function getCallSource(phone) {
  let e164 = toE164(phone);
  if (!e164) return null;

  try {
    // Check calls first
    let calls = await searchCallByPhone(e164);
    if (calls.length > 0) {
      let call = calls.sort(
        (a, b) => new Date(b.start_time) - new Date(a.start_time),
      )[0];
      if (call.source) return call.source;
    }

    // Fall back to SMS threads
    let threads = await searchSMSByPhone(e164);
    if (threads.length > 0) {
      let sms = threads.sort(
        (a, b) => new Date(b.last_message_at) - new Date(a.last_message_at),
      )[0];
      if (sms.source) return sms.source;
    }

    return null;
  } catch (e) {
    console.warn("CallRail: Source lookup failed:", e.message);
    return null;
  }
}
