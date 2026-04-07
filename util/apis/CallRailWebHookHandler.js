import * as Sentry from "@sentry/node";
import events from "../events.js";
import { uploadConversionAdjustment } from "./GoogleAdsConversions.js";

/**
 * Handles a CallRail call-modified webhook.
 * When a call has both a value and a GCLID, uploads a conversion
 * value adjustment to Google Ads.
 * @param {import("express").Request} req
 */
async function handleCallModified(req) {
  const call = req.body;
  const callId = call.id || call.call_id || call.callrail_id || "unknown";

  try {
    const callValue = call.value ? parseFloat(call.value) : 0;
    const gclid = call.gclid || null;

    console.log(
      `CallRail Webhook: call-modified id=${callId} value=${callValue} gclid=${gclid || "none"} source=${call.source_name || "unknown"} start_time=${call.start_time || "none"}`,
    );

    if (process.env.DEBUG === "TRUE") {
      console.log(
        "CallRail Webhook: call-modified payload keys:",
        Object.keys(call),
      );
    }

    if (callValue > 0 && gclid) {
      console.log(
        `CallRail Webhook: Call ${callId} has value $${callValue} and GCLID — sending adjustment to Google Ads`,
      );

      await uploadConversionAdjustment({
        gclid,
        conversionDateTime: call.start_time,
        adjustedValue: callValue,
      });
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
  const callId = call.id || call.call_id || call.callrail_id || "unknown";

  try {
    const callValue = call.value ? parseFloat(call.value) : 0;
    const gclid = call.gclid || null;

    console.log(
      `CallRail Webhook: outbound-call-modified id=${callId} value=${callValue} gclid=${gclid || "none"}`,
    );

    if (callValue > 0 && gclid) {
      console.log(
        `CallRail Webhook: Outbound call ${callId} has value $${callValue} and GCLID — sending adjustment to Google Ads`,
      );

      await uploadConversionAdjustment({
        gclid,
        conversionDateTime: call.start_time,
        adjustedValue: callValue,
      });
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
    `CallRail Webhook: pre-call id=${req.body.id} from=${req.body.customer_phone_number}`,
  );
}
events.on("callrail-pre-call", handlePreCall);

function handleCallRoutingComplete(req) {
  console.log(
    `CallRail Webhook: call-routing-complete id=${req.body.id} from=${req.body.customer_phone_number}`,
  );
}
events.on("callrail-call-routing-complete", handleCallRoutingComplete);

function handlePostCall(req) {
  console.log(
    `CallRail Webhook: post-call id=${req.body.id} from=${req.body.customer_phone_number} duration=${req.body.duration}`,
  );
}
events.on("callrail-post-call", handlePostCall);

function handleOutboundPostCall(req) {
  console.log(
    `CallRail Webhook: outbound-post-call id=${req.body.id} duration=${req.body.duration}`,
  );
}
events.on("callrail-outbound-post-call", handleOutboundPostCall);

function handleTextMessageSent(req) {
  console.log(`CallRail Webhook: text-message-sent id=${req.body.id}`);
}
events.on("callrail-text-message-sent", handleTextMessageSent);

function handleTextMessageReceived(req) {
  console.log(
    `CallRail Webhook: text-message-received id=${req.body.id} from=${req.body.customer_phone_number}`,
  );
}
events.on("callrail-text-message-received", handleTextMessageReceived);
