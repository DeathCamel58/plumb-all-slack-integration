import * as Sentry from "@sentry/node";
import prisma from "../prismaClient.js";
import { isUniqueConstraintOn } from "../prismaErrors.js";
import { STALE_CLAIM_MS } from "./GoogleAdsClickTracking.js";
import {
  toEventTimestamp,
  uploadClickConversion,
  uploadConversionAdjustment,
} from "./GoogleAdsConversions.js";

/**
 * Invoice values for calls from the call button on an ad (CallRail source
 * "Google Ads Assets").
 *
 * Those calls already count once through Google's native "Calls from ads"
 * action, which can't be restated by GCLID. So once a call has a value, it is
 * uploaded to a separate, secondary click-conversion action
 * (GOOGLE_ADS_ASSET_VALUE_CONVERSION_ACTION_ID) that only carries value, and
 * bidding never counts the call twice.
 *
 * One GoogleAdsAssetCallValue row is kept per call. Data Manager dedupes on
 * transactionId, so a changed value must go through a restatement against the
 * stored conversionDateTime instead of a second upload.
 */

/**
 * @param {*} a
 * @param {*} b
 * @returns {boolean} Whether two dollar amounts are equal to the cent
 */
function sameValue(a, b) {
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

/**
 * Claims the call's row, then uploads its value as a new click conversion.
 * The claim is released if the upload fails (or is a dry run), so the next
 * webhook for the call retries.
 */
async function claimAndUpload({
  gclid,
  callId,
  startTime,
  value,
  conversionActionId,
}) {
  try {
    await prisma.googleAdsAssetCallValue.create({
      data: {
        callId,
        gclid,
        conversionDateTime: toEventTimestamp(startTime),
        value,
        uploadedAt: null,
      },
    });
  } catch (e) {
    if (isUniqueConstraintOn(e, "callId", "GoogleAdsAssetCallValue_pkey")) {
      console.log(
        `GoogleAds: Asset call ${callId} was claimed concurrently, skipping upload`,
      );
      return;
    }
    throw e;
  }

  const result = await uploadClickConversion({
    gclid,
    conversionDateTime: startTime,
    transactionId: callId,
    conversionValue: value,
    conversionActionId,
  });

  if (result.success && !result.validateOnly) {
    await prisma.googleAdsAssetCallValue.update({
      where: { callId },
      data: { uploadedAt: new Date(), requestId: result.requestId ?? null },
    });
  } else {
    await prisma.googleAdsAssetCallValue.deleteMany({
      where: { callId, uploadedAt: null },
    });
  }
}

/**
 * Sends a call-asset call's invoice value to the call-asset value action.
 * Never throws.
 *
 * @param {object} params
 * @param {string} params.gclid
 * @param {string} params.callId - CallRail resource_id
 * @param {string} params.startTime - CallRail start_time
 * @param {number} params.value - The call's value
 */
export async function sendAssetCallValue({ gclid, callId, startTime, value }) {
  const conversionActionId =
    process.env.GOOGLE_ADS_ASSET_VALUE_CONVERSION_ACTION_ID;
  if (!conversionActionId) {
    console.warn(
      "GoogleAds: Missing GOOGLE_ADS_ASSET_VALUE_CONVERSION_ACTION_ID, skipping call asset value",
    );
    return;
  }

  if (!callId) {
    console.warn(
      `GoogleAds: Asset call value for gclid=${gclid} has no call id, skipping`,
    );
    return;
  }

  if (!startTime || isNaN(new Date(startTime).getTime())) {
    console.warn(
      `GoogleAds: Invalid start_time "${startTime}" for asset call ${callId}, skipping`,
    );
    return;
  }

  try {
    const params = { gclid, callId, startTime, value, conversionActionId };
    const row = await prisma.googleAdsAssetCallValue.findUnique({
      where: { callId },
    });

    if (!row) {
      await claimAndUpload(params);
      return;
    }

    if (!row.uploadedAt) {
      if (Date.now() - new Date(row.createdAt).getTime() <= STALE_CLAIM_MS) {
        console.log(
          `GoogleAds: Asset call ${callId} has an upload in progress, skipping`,
        );
        return;
      }
      console.warn(
        `GoogleAds: Releasing stale un-uploaded claim on asset call ${callId} (created ${row.createdAt.toISOString?.() ?? row.createdAt}) — re-claiming`,
      );
      // Conditional delete, so a concurrent mark-uploaded is never wiped out
      await prisma.googleAdsAssetCallValue.deleteMany({
        where: {
          callId,
          uploadedAt: null,
          createdAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) },
        },
      });
      await claimAndUpload(params);
      return;
    }

    if (sameValue(row.value, value)) {
      console.log(
        `GoogleAds: Asset call ${callId} value $${value} already sent, skipping`,
      );
      return;
    }

    console.log(
      `GoogleAds: Restating asset call ${callId} from $${Number(row.value)} to $${value}`,
    );
    const result = await uploadConversionAdjustment({
      gclid,
      conversionDateTime: row.conversionDateTime,
      adjustedValue: value,
      conversionActionId,
    });
    if (result === true) {
      await prisma.googleAdsAssetCallValue.update({
        where: { callId },
        data: { value, restatedAt: new Date() },
      });
    }
  } catch (e) {
    Sentry.captureException(e, { extra: { gclid, callId, value } });
    console.error(
      `GoogleAds: Error sending asset call value for call ${callId}:`,
      e,
    );
  }
}
