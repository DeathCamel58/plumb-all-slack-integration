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
 * Invoice values for form leads from Google Ads clicks: Google Ads lead forms
 * and the website contact form.
 *
 * Lead form submissions already count once through Google's native
 * "Lead form - Submit" action, which can't be restated. So when a lead's first
 * invoice is paid, its value is uploaded against the lead's GCLID to a
 * separate, secondary click-conversion action
 * (GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID) that only carries value,
 * and bidding never counts the lead twice.
 *
 * Website contact forms that arrive with a click ID are uploaded right away at
 * $0 to their own action (GOOGLE_ADS_FORM_CONVERSION_ACTION_ID), so they count
 * as leads, and that conversion is restated to the invoice total later, the
 * same way Phone Call conversions are. Website forms without a click ID
 * (organic) are recorded too, but never uploaded: if one is the client's first
 * contact, no value is sent to Google Ads at all.
 *
 * Each submission is recorded with its click ID and SHA-256 hashes of its
 * phone and email. AdValueAttribution.js matches a paid invoice's client to
 * the form leads and CallRail calls from the 30 days before the work started,
 * and credits the value to whichever came first. Data Manager dedupes on transactionId (the lead id),
 * so a changed value goes through a restatement instead of a second upload.
 */

export const SOURCE_GOOGLE_LEAD_FORM = "google_lead_form";
export const SOURCE_WEBSITE_FORM = "website_form";

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
  if (a === null || a === undefined) {
    return false;
  }
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

/**
 * @param {object} lead - A GoogleAdsLeadFormLead row
 * @returns {string|undefined} The conversion action resource name the lead's
 *   value goes to
 */
function conversionActionFor(lead) {
  return (
    lead.conversionAction ??
    process.env.GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID
  );
}

/**
 * Accepts a click ID from untrusted input only if it looks like one.
 * @param {*} id
 * @returns {string|null}
 */
function cleanClickId(id) {
  if (typeof id !== "string") {
    return null;
  }
  const trimmed = id.trim();
  return /^[\w-]{1,512}$/.test(trimmed) ? trimmed : null;
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
 * @param {object} lead - A GoogleAdsLeadFormLead row
 * @returns {boolean} Whether the lead came from a Google Ads click
 */
function hasClickId(lead) {
  return Boolean(lead.gclid || lead.gbraid || lead.wbraid);
}

/**
 * Records a website contact form. One from a Google Ads click is uploaded as a
 * $0 conversion, so it counts as a lead, and its value is restated if it turns
 * out to be the client's first contact. One without a click ID (organic) is
 * only recorded, so it can still be the client's first contact and keep the
 * value from going to Google Ads. Never throws.
 *
 * @param {object} data - The website contact form body (gclid/gbraid/wbraid,
 *   phone, email)
 * @param {Date} [receivedAt] - When the form arrived
 */
export async function recordWebsiteFormLead(data, receivedAt = new Date()) {
  const conversionActionId = process.env.GOOGLE_ADS_FORM_CONVERSION_ACTION_ID;
  if (!conversionActionId) {
    return;
  }

  const gclid = cleanClickId(data?.gclid);
  const gbraid = cleanClickId(data?.gbraid);
  const wbraid = cleanClickId(data?.wbraid);
  const fromAd = Boolean(gclid || gbraid || wbraid);

  const phoneHash = hashPhone(data?.phone);
  const emailHash = hashEmail(data?.email);
  if (!fromAd && !phoneHash && !emailHash) {
    // Nothing to match a client on, and nothing to upload
    return;
  }

  const leadId = `web-${crypto.randomUUID()}`;
  try {
    const lead = await prisma.googleAdsLeadFormLead.create({
      data: {
        leadId,
        source: SOURCE_WEBSITE_FORM,
        conversionAction: fromAd ? conversionActionId : null,
        gclid,
        gbraid,
        wbraid,
        phoneHash,
        emailHash,
        conversionDateTime: toEventTimestamp(receivedAt.toISOString()),
      },
    });
    if (!fromAd) {
      console.log(`GoogleAds: Recorded organic website form lead ${leadId}`);
      return;
    }
    console.log(`GoogleAds: Recorded website form lead ${leadId}`);
    await claimAndUpload(lead, 0, conversionActionId);
  } catch (e) {
    Sentry.captureException(e, { extra: { leadId } });
    console.error(`GoogleAds: Error recording website form lead ${leadId}:`, e);
  }
}

/**
 * Claims the lead's row, then uploads its value as a new click conversion.
 * The claim is released if the upload fails (or is a dry run), so the next
 * payment event for the client retries. (A website form's $0 upload isn't
 * retried; its value is then sent as a new upload when the invoice is paid.)
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
      `GoogleAds: Form lead ${lead.leadId} has an upload in progress, skipping`,
    );
    return;
  }

  const result = await uploadClickConversion({
    gclid: lead.gclid ?? undefined,
    gbraid: lead.gbraid ?? undefined,
    wbraid: lead.wbraid ?? undefined,
    conversionDateTime: lead.conversionDateTime,
    transactionId: lead.leadId,
    conversionValue: value,
    conversionActionId,
    ...(lead.source === SOURCE_WEBSITE_FORM ? { eventSource: "WEB" } : {}),
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
 * Finds the client's earliest recorded form lead (Google Ads lead form or
 * website form) between `from` and `until`, matched by phone or email hash.
 * By default that's anything within Google's click window. Never throws.
 *
 * Google Ads lead form leads are skipped when their value action isn't
 * configured, so callers fall back to crediting another source rather than a
 * lead that can't be sent. Organic website form leads are included: they have
 * no value to send, but they still count as the first contact.
 *
 * @param {object} client - The Jobber client (phones[].number, emails[].address)
 * @param {object} [window]
 * @param {Date} [window.from] - Earliest submission to match (default: 90 days ago)
 * @param {Date} [window.until] - Latest submission to match (default: now)
 * @returns {Promise<object|null>} The GoogleAdsLeadFormLead row, or null
 */
export async function findFormLead(client, { from, until } = {}) {
  if (!client) {
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
        createdAt: {
          gte: from ?? new Date(Date.now() - LEAD_MATCH_WINDOW_MS),
          ...(until ? { lte: until } : {}),
        },
        OR: [
          ...(phoneHashes.length ? [{ phoneHash: { in: phoneHashes } }] : []),
          ...(emailHashes.length ? [{ emailHash: { in: emailHashes } }] : []),
        ],
        // Google Ads lead form rows need the lead form value action
        ...(process.env.GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID
          ? {}
          : { source: { not: SOURCE_GOOGLE_LEAD_FORM } }),
      },
      orderBy: { createdAt: "asc" },
    });
  } catch (e) {
    Sentry.captureException(e, { extra: { clientId: client.id } });
    console.error(
      `GoogleAds: Error looking up form lead for client ${client.id}:`,
      e,
    );
    return null;
  }
}

/**
 * Sends a form lead's invoice value to its conversion action. Uploads it if
 * the lead was never uploaded; otherwise restates it by lead id (a website
 * form's $0 conversion, or a changed value). An organic form has no Google
 * Ads click, so nothing is sent. Never throws.
 *
 * @param {object} lead - A row from findFormLead()
 * @param {number} value - The invoice total
 */
export async function sendFormValue(lead, value) {
  if (!hasClickId(lead)) {
    console.log(
      `GoogleAds: First contact was organic website form ${lead.leadId}, not sending its $${value} value to Google Ads`,
    );
    return;
  }

  const conversionActionId = conversionActionFor(lead);
  if (!conversionActionId) {
    console.warn(
      `GoogleAds: No conversion action for form lead ${lead.leadId}, skipping its value`,
    );
    return;
  }

  try {
    if (!lead.uploadedAt) {
      console.log(
        `GoogleAds: Sending form lead ${lead.leadId} invoice value $${value}`,
      );
      await claimAndUpload(lead, value, conversionActionId);
      return;
    }

    if (sameValue(lead.value, value)) {
      console.log(
        `GoogleAds: Form lead ${lead.leadId} value $${value} already sent, skipping`,
      );
      return;
    }

    console.log(
      `GoogleAds: Restating form lead ${lead.leadId} from $${Number(lead.value)} to $${value}`,
    );
    const result = await uploadConversionAdjustment({
      gclid: lead.gclid ?? undefined,
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
      `GoogleAds: Error sending form value for lead ${lead.leadId}:`,
      e,
    );
  }
}
