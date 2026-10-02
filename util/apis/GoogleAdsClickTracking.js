import * as Sentry from "@sentry/node";
import prisma from "../prismaClient.js";
import { isMissingTableError, isUniqueConstraintOn } from "../prismaErrors.js";
import {
  toEventTimestamp,
  uploadConversionAdjustment,
} from "./GoogleAdsConversions.js";

/**
 * Google Ads click conversions, one per GCLID.
 *
 * The first qualifying call on a click claims a GoogleAdsClickConversion row and
 * is the only call uploaded. Every value restatement for that GCLID is then sent
 * against the stored first-call conversionDateTime, whichever call the invoice
 * value landed on.
 *
 * The table may not exist yet if this code deploys before its migration is
 * applied. In that case creation uploads without dedupe and restatement uses the
 * call's own start_time, so a missing table never drops a conversion.
 */

/**
 * Logs (and reports) a database failure on the click conversion table.
 * @param {string} action What we were trying to do
 * @param {*} e The error
 * @param {object} extra Sentry context
 */
function reportStoreError(action, e, extra) {
  if (isMissingTableError(e)) {
    console.error(
      `GoogleAds: GoogleAdsClickConversion table does not exist (run \`npx prisma migrate deploy\`) — ${action} falling back to per-call behavior`,
    );
  } else {
    console.error(`GoogleAds: Click conversion store error (${action}):`, e);
  }
  Sentry.captureException(e, { extra: { action, ...extra } });
}

/**
 * Claims a GCLID for its first qualifying call.
 *
 * @param {object} params
 * @param {string} params.gclid
 * @param {string} params.transactionId - CallRail call id
 * @param {string} params.startTime - CallRail start_time
 * @returns {Promise<{status: "claimed", conversionDateTime: string}
 *   | {status: "duplicate", existing: object|null}
 *   | {status: "unavailable"}>}
 *   "unavailable" means the store couldn't be used (e.g. missing table); the
 *   caller should upload anyway without dedupe.
 */
export async function claimClickConversion({
  gclid,
  transactionId,
  startTime,
}) {
  const conversionDateTime = toEventTimestamp(startTime);
  try {
    await prisma.googleAdsClickConversion.create({
      data: {
        gclid,
        transactionId: transactionId ?? null,
        conversionDateTime,
        callStartTime: new Date(startTime),
        uploadedAt: null,
      },
    });
    return { status: "claimed", conversionDateTime };
  } catch (e) {
    if (isUniqueConstraintOn(e, "gclid", "GoogleAdsClickConversion_pkey")) {
      let existing = null;
      try {
        existing = await prisma.googleAdsClickConversion.findUnique({
          where: { gclid },
        });
      } catch (lookupError) {
        console.warn(
          `GoogleAds: Could not load existing click conversion for gclid=${gclid}:`,
          lookupError,
        );
      }
      return { status: "duplicate", existing };
    }
    reportStoreError("claim", e, { gclid, transactionId });
    return { status: "unavailable" };
  }
}

/**
 * Records a successful upload on a claimed GCLID.
 * @param {string} gclid
 * @param {string|null} requestId - Data Manager requestId
 */
export async function markClickConversionUploaded(gclid, requestId) {
  try {
    await prisma.googleAdsClickConversion.update({
      where: { gclid },
      data: { uploadedAt: new Date(), requestId: requestId ?? null },
    });
  } catch (e) {
    reportStoreError("mark uploaded", e, { gclid, requestId });
  }
}

/**
 * Releases a claim after a failed (or dry-run) upload, so a later qualifying
 * call on the same click can try again. Only deletes the row this call claimed.
 * @param {string} gclid
 * @param {string} transactionId - CallRail call id that made the claim
 */
export async function releaseClickConversion(gclid, transactionId) {
  try {
    await prisma.googleAdsClickConversion.deleteMany({
      where: { gclid, transactionId: transactionId ?? null, uploadedAt: null },
    });
  } catch (e) {
    reportStoreError("release", e, { gclid, transactionId });
  }
}

/**
 * Resolves which conversion a restatement for this GCLID should target.
 *
 * @param {string} gclid
 * @param {string} fallbackStartTime - The valued call's own start_time
 * @returns {Promise<{conversionDateTime: string, row: object|null}>}
 *   row is set only when an uploaded first-call conversion was found. Without
 *   one (conversions from before one-per-click, or a missing table) the call's
 *   own start_time is used, which still matches per-call conversions.
 */
export async function resolveConversionForGclid(gclid, fallbackStartTime) {
  try {
    const row = await prisma.googleAdsClickConversion.findUnique({
      where: { gclid },
    });
    if (row?.uploadedAt) {
      return { conversionDateTime: row.conversionDateTime, row };
    }
  } catch (e) {
    reportStoreError("resolve", e, { gclid });
  }
  return { conversionDateTime: fallbackStartTime, row: null };
}

/**
 * Restates a call's value onto the conversion for its click.
 *
 * RESTATEMENT replaces the conversion's value rather than adding to it, so
 * when several calls on one click carry values, the click's conversion is
 * restated to their sum. Values are tracked per call, so a call-modified
 * webhook that fires again for the same call doesn't count twice.
 *
 * @param {object} params
 * @param {string} params.gclid
 * @param {string} params.startTime - The valued call's start_time
 * @param {number} params.value - The valued call's value
 * @param {string} [params.callId] - CallRail call id of the valued call (for logs)
 * @returns {Promise<boolean|string>} uploadConversionAdjustment()'s result
 */
export async function restateClickConversion({
  gclid,
  startTime,
  value,
  callId,
}) {
  const { conversionDateTime, row } = await resolveConversionForGclid(
    gclid,
    startTime,
  );

  if (!row) {
    return uploadConversionAdjustment({
      gclid,
      conversionDateTime,
      adjustedValue: value,
    });
  }

  // Keyed by normalized start_time: webhook payloads and CallRail API results
  // both carry it in the same form, unlike their call id field names.
  const callKey = toEventTimestamp(startTime);
  const callLabel = callId || callKey;
  const restatedCalls = { ...(row.restatedCalls ?? {}), [callKey]: value };
  const total =
    Math.round(
      Object.values(restatedCalls).reduce((sum, v) => sum + Number(v), 0) * 100,
    ) / 100;
  const previousTotal =
    row.restatedValue === null || row.restatedValue === undefined
      ? null
      : Number(row.restatedValue);
  const otherCalls = Object.keys(restatedCalls).filter((k) => k !== callKey);

  if (otherCalls.length > 0) {
    console.warn(
      `GoogleAds: gclid=${gclid} already restated to $${previousTotal} — adding $${value} from call ${callLabel}, restating first-call conversion to the sum $${total}`,
    );
  }

  console.log(
    `GoogleAds: Restating gclid=${gclid} value=$${total} against first call ${row.transactionId || "unknown"} datetime=${conversionDateTime} (value from call ${callLabel})`,
  );

  const result = await uploadConversionAdjustment({
    gclid,
    conversionDateTime,
    adjustedValue: total,
  });

  if (result === true) {
    try {
      await prisma.googleAdsClickConversion.update({
        where: { gclid },
        data: {
          restatedValue: total,
          restatedCalls,
          restatedAt: new Date(),
        },
      });
    } catch (e) {
      reportStoreError("record restatement", e, { gclid, total });
    }
  }

  return result;
}
