import * as Sentry from "@sentry/node";
import events from "../events.js";
import {
  uploadClickConversion,
  uploadConversionAdjustment,
} from "./GoogleAdsConversions.js";

/**
 * Calls shorter than this are not sent to Google Ads as conversions. Derived from
 * call/revenue data (short calls produce almost no revenue); override with
 * GOOGLE_ADS_MIN_CALL_DURATION to retune.
 */
const MIN_CALL_DURATION_SECONDS = 60;

/**
 * Read at call time rather than module load, since dotenv is configured after
 * ESM imports are evaluated.
 * @returns {number}
 */
function getMinCallDurationSeconds() {
  const override = parseInt(process.env.GOOGLE_ADS_MIN_CALL_DURATION, 10);
  return Number.isFinite(override) && override >= 0
    ? override
    : MIN_CALL_DURATION_SECONDS;
}

/**
 * Handles a CallRail call-modified webhook.
 * When a call has both a value and a GCLID, uploads a conversion
 * value adjustment to Google Ads.
 * @param {import("express").Request} req
 */
async function handleCallModified(req) {
  const call = req.body;
  const callId = call.customer_phone_number || "unknown";

  try {
    const callValue = call.value ? parseFloat(call.value) : 0;
    const gclid = call.gclid || null;
    const sourceName = call.source_name || "unknown";

    console.log(
      `CallRail Webhook: call-modified caller=${callId} value=${callValue} gclid=${gclid || "none"} source=${sourceName} start_time=${call.start_time || "none"}`,
    );

    if (process.env.DEBUG === "TRUE") {
      console.log(
        "CallRail Webhook: call-modified payload keys:",
        Object.keys(call),
      );
    }

    if (callValue > 0 && gclid) {
      if (sourceName === "Google Ads Assets") {
        console.log(
          `CallRail Webhook: Call ${callId} is from a Google Ads Call Asset — GCLID not tied to a website conversion, skipping adjustment`,
        );
      } else {
        console.log(
          `CallRail Webhook: Call ${callId} has value $${callValue} and GCLID — sending adjustment to Google Ads`,
        );

        await uploadConversionAdjustment({
          gclid,
          conversionDateTime: call.start_time,
          adjustedValue: callValue,
        });
      }
    } else if (callValue > 0 && !gclid) {
      console.log(
        `CallRail Webhook: Call ${callId} has value $${callValue} but no GCLID — skipping Google Ads adjustment`,
      );
    }
  } catch (e) {
    Sentry.captureException(e);
    console.error("CallRail Webhook: Error handling call-modified:", e);
  }
}
events.on("callrail-call-modified", handleCallModified);

/**
 * Handles a CallRail outbound-call-modified webhook.
 * Same logic as call-modified for value + GCLID.
 * @param {import("express").Request} req
 */
async function handleOutboundCallModified(req) {
  const call = req.body;
  const callId = call.customer_phone_number || "unknown";

  try {
    const callValue = call.value ? parseFloat(call.value) : 0;
    const gclid = call.gclid || null;
    const sourceName = call.source_name || "unknown";

    console.log(
      `CallRail Webhook: outbound-call-modified caller=${callId} value=${callValue} gclid=${gclid || "none"}`,
    );

    if (callValue > 0 && gclid) {
      if (sourceName === "Google Ads Assets") {
        console.log(
          `CallRail Webhook: Outbound call ${callId} is from a Google Ads Call Asset — GCLID not tied to a website conversion, skipping adjustment`,
        );
      } else {
        console.log(
          `CallRail Webhook: Outbound call ${callId} has value $${callValue} and GCLID — sending adjustment to Google Ads`,
        );

        await uploadConversionAdjustment({
          gclid,
          conversionDateTime: call.start_time,
          adjustedValue: callValue,
        });
      }
    }
  } catch (e) {
    Sentry.captureException(e);
    console.error(
      "CallRail Webhook: Error handling outbound-call-modified:",
      e,
    );
  }
}
events.on("callrail-outbound-call-modified", handleOutboundCallModified);

// Stub handlers for remaining webhook types — log for now

function handlePreCall(req) {
  console.log(
    `CallRail Webhook: pre-call from=${req.body.customer_phone_number}`,
  );
}
events.on("callrail-pre-call", handlePreCall);

function handleCallRoutingComplete(req) {
  console.log(
    `CallRail Webhook: call-routing-complete from=${req.body.customer_phone_number}`,
  );
}
events.on("callrail-call-routing-complete", handleCallRoutingComplete);

/**
 * Handles a CallRail post-call webhook (inbound calls only).
 * Creates a $0 Google Ads click conversion for ad-attributed calls that lasted
 * at least the minimum duration. The value is restated later by
 * handleCallModified() once the customer pays, matched by gclid + start_time.
 * @param {import("express").Request} req
 */
async function handlePostCall(req) {
  const call = req.body;
  const callId = call.customer_phone_number || "unknown";

  try {
    const duration = Number(call.duration);
    const gclid = call.gclid || null;
    const sourceName = call.source_name || "unknown";
    const minDuration = getMinCallDurationSeconds();

    console.log(
      `CallRail Webhook: post-call caller=${callId} duration=${call.duration} gclid=${gclid || "none"} source=${sourceName} direction=${call.direction || "none"} start_time=${call.start_time || "none"}`,
    );

    let skipReason = null;
    if (call.direction && call.direction !== "inbound") {
      skipReason = `direction=${call.direction} is not inbound`;
    } else if (!Number.isFinite(duration) || duration < minDuration) {
      skipReason = `duration=${call.duration} is under ${minDuration}s`;
    } else if (!gclid) {
      skipReason = "no GCLID";
    } else if (sourceName === "Google Ads Assets") {
      skipReason =
        "source is Google Ads Call Asset — GCLID not tied to a website conversion";
    }

    if (skipReason) {
      console.log(
        `CallRail Webhook: post-call conversion SKIP caller=${callId} reason=${skipReason}`,
      );
      return;
    }

    console.log(
      `CallRail Webhook: post-call conversion SEND caller=${callId} duration=${duration}s gclid=${gclid} start_time=${call.start_time}`,
    );

    await uploadClickConversion({
      gclid,
      conversionDateTime: call.start_time,
    });
  } catch (e) {
    Sentry.captureException(e);
    console.error("CallRail Webhook: Error handling post-call:", e);
  }
}
events.on("callrail-post-call", handlePostCall);

function handleOutboundPostCall(req) {
  console.log(
    `CallRail Webhook: outbound-post-call duration=${req.body.duration}`,
  );
}
events.on("callrail-outbound-post-call", handleOutboundPostCall);

function handleTextMessageSent(req) {
  console.log(
    `CallRail Webhook: text-message-sent to=${req.body.customer_phone_number}`,
  );
}
events.on("callrail-text-message-sent", handleTextMessageSent);

function handleTextMessageReceived(req) {
  console.log(
    `CallRail Webhook: text-message-received from=${req.body.customer_phone_number}`,
  );
}
events.on("callrail-text-message-received", handleTextMessageReceived);
