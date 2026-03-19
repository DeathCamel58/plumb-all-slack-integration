import fetch from "node-fetch";
import events from "../events.js";
import prisma from "../prismaClient.js";
import { toE164 } from "../DataUtilities.js";
import * as Sentry from "@sentry/node";

const CALLRAIL_API_KEY = process.env.CALLRAIL_API_KEY;
const CALLRAIL_ACCOUNT_ID = process.env.CALLRAIL_ACCOUNT_ID;
const BASE_URL = `https://api.callrail.com/v3/a/${CALLRAIL_ACCOUNT_ID}`;

/**
 * Search CallRail for a call matching the given phone number
 * @param {string} phoneE164 Phone number in E.164 format
 * @returns {Promise<object|null>} The first matching call or null
 */
async function searchCallByPhone(phoneE164) {
  let response = await fetch(
    `${BASE_URL}/calls.json?search=${encodeURIComponent(phoneE164)}`,
    {
      headers: {
        Authorization: `Token token="${CALLRAIL_API_KEY}"`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `CallRail search failed: ${response.status} ${response.statusText}`,
    );
  }

  let data = await response.json();
  if (data.calls && data.calls.length > 0) {
    return data.calls[0];
  }
  return null;
}

/**
 * Update a CallRail call with lead status, value, note, and tags
 * @param {string} callId The CallRail call ID
 * @param {object} params
 * @param {number} params.value The monetary value
 * @param {string} params.note A note to attach
 * @returns {Promise<object>} The updated call
 */
async function updateCall(callId, { value, note, customer_name }) {
  let response = await fetch(`${BASE_URL}/calls/${callId}.json`, {
    method: "PUT",
    headers: {
      Authorization: `Token token="${CALLRAIL_API_KEY}"`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customer_name: customer_name,
      lead_status: "good_lead",
      value: value,
      note: note,
      tags: ["invoice-paid"],
      append_tags: true,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `CallRail update failed: ${response.status} ${response.statusText}`,
    );
  }

  return await response.json();
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

    // Extract primary phone (or first available)
    let phones = payment.client.phones;
    if (!phones || phones.length === 0) {
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
    let primaryPhone = phones.find((p) => p.primary);
    let phone = primaryPhone ? primaryPhone.number : phones[0].number;

    let phoneE164 = toE164(phone);
    if (!phoneE164) {
      Sentry.captureMessage("CallRail: Could not convert phone to E.164", {
        level: "warning",
        extra: { phone, clientId: payment.client.id },
      });
      console.warn("CallRail: Could not convert phone to E.164", phone);
      return;
    }

    // Search for matching call in CallRail
    let call = await searchCallByPhone(phoneE164);
    if (!call) {
      console.log("CallRail: No matching call found for", phoneE164);
      return;
    }

    // Update the call with conversion data
    await updateCall(call.id, {
      value: invoice.amounts.total,
      note: `Client: ${payment.client.jobberWebUri}\nInvoice: ${invoice.jobberWebUri}`,
      customer_name: payment.client.name,
    });

    console.log(
      "CallRail: Reported first invoice conversion for call",
      call.id,
    );
  } catch (e) {
    Sentry.captureException(e);
    console.error("CallRail: Error handling first invoice payment:", e);
  }
}

events.on("callrail-FIRST_INVOICE_PAYMENT", handleFirstInvoicePayment);
