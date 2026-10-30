import * as Sentry from "@sentry/node";
import prisma from "../prismaClient.js";
import { markCallNotALead } from "./CallRail.js";
import { uploadConversionAdjustment } from "./GoogleAdsConversions.js";

/**
 * Bad leads flagged in Slack.
 *
 * An X reaction on (or deletion of) a CallRail "New Call" post in call-logs
 * marks the call not a lead in CallRail and retracts the Google Ads
 * conversion it created, so bidding stops learning from it.
 *
 * Only the click's first qualifying call holds a conversion; a repeat call on
 * the same click has nothing to retract. A retraction can fail while a
 * just-uploaded conversion is still processing in Google Ads, so the request is
 * stored and retried hourly.
 */

/** How long a failed retraction keeps being retried */
export const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const RETRY_INTERVAL_MS = 60 * 60 * 1000;

/** Calls already handled by this process, so a reaction and a deletion only act once */
const handledCalls = new Set();

/**
 * The conversions a call can hold. Read at call time, since dotenv is
 * configured after ESM imports are evaluated.
 */
const CONVERSION_KINDS = [
  {
    label: "call conversion",
    model: () => prisma.googleAdsClickConversion,
    whereCall: (callId) => ({ transactionId: callId }),
    key: (row) => ({ gclid: row.gclid }),
    orderId: (row) => row.transactionId,
    conversionActionId: () => process.env.GOOGLE_ADS_CONVERSION_ACTION_ID,
  },
  {
    label: "call-asset value",
    model: () => prisma.googleAdsAssetCallValue,
    whereCall: (callId) => ({ callId }),
    key: (row) => ({ callId: row.callId }),
    orderId: (row) => row.callId,
    conversionActionId: () =>
      process.env.GOOGLE_ADS_ASSET_VALUE_CONVERSION_ACTION_ID,
  },
];

/**
 * @returns {boolean} true when retractions should only be validated by Google, not applied
 */
function isValidateOnly() {
  return (
    process.env.GOOGLE_ADS_RETRACTION_VALIDATE_ONLY?.toUpperCase() === "TRUE"
  );
}

/**
 * Pulls the CallRail call id out of a CallRail "New Call" Slack post. The
 * post links to the call with `event_id=CAL…`; text and SMS posts are skipped.
 * @param {string} text Raw Slack message text
 * @returns {string|null}
 */
export function callIdFromCallRailMessage(text) {
  if (!text || !/\*New Call\*/.test(text)) return null;
  const match = text.match(/event_id=(CAL[0-9a-f]+)/i);
  return match ? match[1] : null;
}

/**
 * Sends one retraction and records it when Google accepts it.
 * @param {object} kind An entry of CONVERSION_KINDS
 * @param {object} row The stored conversion
 * @param {boolean} validateOnly
 * @returns {Promise<"retracted"|"validated"|"pending">}
 */
async function sendRetraction(kind, row, validateOnly) {
  const result = await uploadConversionAdjustment({
    gclid: row.gclid,
    conversionDateTime: row.conversionDateTime,
    orderId: kind.orderId(row),
    conversionActionId: kind.conversionActionId(),
    adjustmentType: "RETRACTION",
    validateOnly,
  });

  if (result !== true) return "pending";
  if (validateOnly) return "validated";

  await kind.model().update({
    where: kind.key(row),
    data: { retractedAt: new Date() },
  });
  return "retracted";
}

/**
 * Retracts the conversion of one kind that a call created, if it has one.
 * @param {object} kind An entry of CONVERSION_KINDS
 * @param {string} callId
 * @param {boolean} validateOnly
 * @returns {Promise<string|null>} status, or null when the call has no conversion of this kind
 */
async function retractKind(kind, callId, validateOnly) {
  try {
    const row = await kind.model().findFirst({ where: kind.whereCall(callId) });
    if (!row?.uploadedAt) return null;
    if (row.retractedAt) return "already retracted";

    if (!validateOnly) {
      // Stored first, so a failed attempt is retried and later restatements skip it
      await kind.model().updateMany({
        where: { ...kind.key(row), retractRequestedAt: null },
        data: { retractRequestedAt: new Date() },
      });
    }

    return await sendRetraction(kind, row, validateOnly);
  } catch (e) {
    Sentry.captureException(e, { extra: { callId, kind: kind.label } });
    console.error(
      `CallRail Bad Lead: Failed to retract ${kind.label} for call ${callId}:`,
      e,
    );
    return "failed";
  }
}

/**
 * Marks a call as a bad lead: not a lead in CallRail, and its Google Ads
 * conversion retracted.
 * @param {object} params
 * @param {string} params.callId CallRail call id (CAL…)
 * @param {string} params.trigger What flagged it, for the CallRail note and logs
 * @returns {Promise<{duplicate: boolean, callRail: "marked"|"disabled"|"failed"|null,
 *   conversions: Array<{label: string, status: string}>, validateOnly: boolean}>}
 */
export async function markCallBadLead({ callId, trigger }) {
  const validateOnly = isValidateOnly();
  if (handledCalls.has(callId)) {
    console.log(
      `CallRail Bad Lead: Call ${callId} already handled (${trigger}), skipping`,
    );
    return { duplicate: true, callRail: null, conversions: [], validateOnly };
  }
  handledCalls.add(callId);

  console.log(`CallRail Bad Lead: Marking call ${callId} — ${trigger}`);

  let callRail;
  try {
    const updated = await markCallNotALead(
      callId,
      `Marked not a lead from Slack (${trigger})`,
    );
    callRail = updated ? "marked" : "disabled";
  } catch (e) {
    Sentry.captureException(e, { extra: { callId } });
    console.error(
      `CallRail Bad Lead: Failed to mark call ${callId} not a lead:`,
      e,
    );
    callRail = "failed";
    // Let another reaction try again
    handledCalls.delete(callId);
  }

  const conversions = [];
  for (const kind of CONVERSION_KINDS) {
    const status = await retractKind(kind, callId, validateOnly);
    if (status) conversions.push({ label: kind.label, status });
  }

  console.log(
    `CallRail Bad Lead: Call ${callId} — CallRail ${callRail}; ${conversions.map((c) => `${c.label} ${c.status}`).join(", ") || "no Google Ads conversion"}${validateOnly ? " (validateOnly)" : ""}`,
  );
  return { duplicate: false, callRail, conversions, validateOnly };
}

/**
 * Sends every stored retraction that Google hasn't accepted yet.
 * @returns {Promise<void>}
 */
export async function retryPendingRetractions() {
  const since = new Date(Date.now() - RETRY_WINDOW_MS);
  for (const kind of CONVERSION_KINDS) {
    let rows;
    try {
      rows = await kind.model().findMany({
        where: {
          retractedAt: null,
          retractRequestedAt: { not: null, gte: since },
        },
      });
    } catch (e) {
      Sentry.captureException(e, { extra: { kind: kind.label } });
      console.error(
        `CallRail Bad Lead: Failed to load pending ${kind.label} retractions:`,
        e,
      );
      continue;
    }

    for (const row of rows) {
      try {
        const status = await sendRetraction(kind, row, false);
        console.log(
          `CallRail Bad Lead: Retry of ${kind.label} retraction for order ${kind.orderId(row)}: ${status}`,
        );
      } catch (e) {
        Sentry.captureException(e, { extra: { kind: kind.label } });
        console.error(
          `CallRail Bad Lead: Retry of ${kind.label} retraction failed:`,
          e,
        );
      }
    }
  }
}

setInterval(retryPendingRetractions, RETRY_INTERVAL_MS).unref();
