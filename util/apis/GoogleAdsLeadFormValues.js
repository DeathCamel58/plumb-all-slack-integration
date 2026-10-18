import crypto from "crypto";
import * as Sentry from "@sentry/node";
import prisma from "../prismaClient.js";
import { isUniqueConstraintOn } from "../prismaErrors.js";
import { toE164 } from "../DataUtilities.js";
import { STALE_CLAIM_MS } from "./GoogleAdsClickTracking.js";
import {
  toEventTimestamp,
  uploadClickConversion,
  uploadConversionAdjustment,
} from "./GoogleAdsConversions.js";

/**
 * Invoice values for Google Ads lead form submissions.
 *
 * Lead form submissions already count once through Google's native
 * "Lead form - Submit" action, which can't be restated. So when a lead's first
 * invoice is paid, its value is uploaded against the lead's GCLID to a
 * separate, secondary click-conversion action
 * (GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID) that only carries value,
 * and bidding never counts the lead twice.
 *
 * Each submission is recorded with its GCLID and SHA-256 hashes of its phone
 * and email. CallRail's first-invoice handler matches a paying client to the
 * most recent recorded lead from within Google's 90-day click window, and
 * credits the value to whichever came first: the lead form or the client's
 * earliest CallRail call. Data Manager dedupes on transactionId (the lead_id),
 * so a changed value goes through a restatement instead of a second upload.
 */

/** Google only accepts click conversions within 90 days of the click. */
export const LEAD_MATCH_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * @param {string|null|undefined} phone
 * @returns {string|null} SHA-256 of the E.164 form, or null
 */
export function hashPhone(phone) {
  const e164 = toE164(phone);
  return e164 ? crypto.createHash("sha256").update(e164).digest("hex") : null;
}

/**
 * @param {string|null|undefined} email
 * @returns {string|null} SHA-256 of the trimmed, lowercased address, or null
 */
export function hashEmail(email) {
  const normalized = email ? String(email).trim().toLowerCase() : "";
  return normalized
    ? crypto.createHash("sha256").update(normalized).digest("hex")
    : null;
}

/**
 * @param {*} a
 * @param {*} b
 * @returns {boolean} Whether two dollar amounts are equal to the cent
 */
function sameValue(a, b) {
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

/**
 * Records a lead form submission so its click can carry a value later.
 * Never throws.
 *
 * @param {object} data - The parsed lead form webhook body
 * @param {object} userData - The webhook's user_column_data, keyed by column_id
 * @param {Date} [receivedAt] - When the webhook arrived
 */
export async function recordLeadFormLead(
  data,
  userData,
  receivedAt = new Date(),
) {
  if (data?.is_test) {
    console.log("GoogleAds: Test lead form submission, not recording a lead");
    return;
  }

  const leadId = data?.lead_id;
  const gclid = data?.gcl_id;
  if (!leadId || !gclid) {
    console.log(
      `GoogleAds: Lead form ${leadId || "(no lead_id)"} has no GCLID, not recording a lead`,
    );
    return;
  }

  try {
    await prisma.googleAdsLeadFormLead.create({
      data: {
        leadId,
        gclid,
        phoneHash: hashPhone(userData?.PHONE_NUMBER),
        emailHash: hashEmail(userData?.EMAIL),
        conversionDateTime: toEventTimestamp(receivedAt.toISOString()),
      },
    });
    console.log(`GoogleAds: Recorded lead form lead ${leadId}`);
  } catch (e) {
    if (isUniqueConstraintOn(e, "leadId", "GoogleAdsLeadFormLead_pkey")) {
      // Google retries webhooks; the first delivery's row stands
      console.log(`GoogleAds: Lead form lead ${leadId} already recorded`);
      return;
    }
    Sentry.captureException(e, { extra: { leadId } });
    console.error(`GoogleAds: Error recording lead form lead ${leadId}:`, e);
  }
}

/**
 * Claims the lead's row, then uploads its value as a new click conversion.
 * The claim is released if the upload fails (or is a dry run), so the next
 * payment event for the client retries.
 */
async function claimAndUpload(lead, value, conversionActionId) {
  const { count } = await prisma.googleAdsLeadFormLead.updateMany({
    where: {
      leadId: lead.leadId,
      uploadedAt: null,
      OR: [
        { claimedAt: null },
        { claimedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
      ],
    },
    data: { claimedAt: new Date() },
  });
  if (count === 0) {
    console.log(
      `GoogleAds: Lead form lead ${lead.leadId} has an upload in progress, skipping`,
    );
    return;
  }

  const result = await uploadClickConversion({
    gclid: lead.gclid,
    conversionDateTime: lead.conversionDateTime,
    transactionId: lead.leadId,
    conversionValue: value,
    conversionActionId,
  });

  await prisma.googleAdsLeadFormLead.update({
    where: { leadId: lead.leadId },
    data:
      result.success && !result.validateOnly
        ? {
            value,
            uploadedAt: new Date(),
            requestId: result.requestId ?? null,
            claimedAt: null,
          }
        : { claimedAt: null },
  });
}

/**
 * Finds the client's most recent recorded lead form lead from within Google's
 * click window, matched by phone or email hash. Never throws.
 *
 * Returns null when the value action isn't configured, so callers fall back to
 * crediting another source rather than a lead that can't be sent.
 *
 * @param {object} client - The Jobber client (phones[].number, emails[].address)
 * @returns {Promise<object|null>} The GoogleAdsLeadFormLead row, or null
 */
export async function findLeadFormLead(client) {
  if (!process.env.GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID || !client) {
    return null;
  }

  const phoneHashes = (client.phones ?? [])
    .map((p) => hashPhone(p.number))
    .filter(Boolean);
  const emailHashes = (client.emails ?? [])
    .map((e) => hashEmail(e.address))
    .filter(Boolean);
  if (phoneHashes.length === 0 && emailHashes.length === 0) {
    return null;
  }

  try {
    return await prisma.googleAdsLeadFormLead.findFirst({
      where: {
        createdAt: { gte: new Date(Date.now() - LEAD_MATCH_WINDOW_MS) },
        OR: [
          ...(phoneHashes.length ? [{ phoneHash: { in: phoneHashes } }] : []),
          ...(emailHashes.length ? [{ emailHash: { in: emailHashes } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  } catch (e) {
    Sentry.captureException(e, { extra: { clientId: client.id } });
    console.error(
      `GoogleAds: Error looking up lead form lead for client ${client.id}:`,
      e,
    );
    return null;
  }
}

/**
 * Sends a lead form lead's invoice value to the lead form value action.
 * Uploads it the first time; restates it by lead_id if it changes. Never throws.
 *
 * @param {object} lead - A row from findLeadFormLead()
 * @param {number} value - The invoice total
 */
export async function sendLeadFormValue(lead, value) {
  const conversionActionId =
    process.env.GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID;
  if (!conversionActionId) {
    console.warn(
      "GoogleAds: Missing GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID, skipping lead form value",
    );
    return;
  }

  try {
    if (!lead.uploadedAt) {
      console.log(
        `GoogleAds: Sending lead form lead ${lead.leadId} first invoice value $${value}`,
      );
      await claimAndUpload(lead, value, conversionActionId);
      return;
    }

    if (sameValue(lead.value, value)) {
      console.log(
        `GoogleAds: Lead form lead ${lead.leadId} value $${value} already sent, skipping`,
      );
      return;
    }

    console.log(
      `GoogleAds: Restating lead form lead ${lead.leadId} from $${Number(lead.value)} to $${value}`,
    );
    const result = await uploadConversionAdjustment({
      gclid: lead.gclid,
      conversionDateTime: lead.conversionDateTime,
      adjustedValue: value,
      orderId: lead.leadId,
      conversionActionId,
    });
    if (result === true) {
      await prisma.googleAdsLeadFormLead.update({
        where: { leadId: lead.leadId },
        data: { value, restatedAt: new Date() },
      });
    }
  } catch (e) {
    Sentry.captureException(e, { extra: { leadId: lead.leadId, value } });
    console.error(
      `GoogleAds: Error sending lead form value for lead ${lead.leadId}:`,
      e,
    );
  }
}
