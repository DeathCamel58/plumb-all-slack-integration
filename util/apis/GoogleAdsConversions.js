import fetch from "node-fetch";
import * as Sentry from "@sentry/node";

const GOOGLE_ADS_API_VERSION = "v23";

const DATA_MANAGER_INGEST_URL =
  "https://datamanager.googleapis.com/v1/events:ingest";

/**
 * Gets a fresh OAuth2 access token using the refresh token.
 * The refresh token must carry both the adwords and datamanager scopes.
 * @returns {Promise<string>} Access token
 */
async function getAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `GoogleAds: OAuth token refresh failed (${response.status}): ${text}`,
    );
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Uploads a conversion value adjustment to Google Ads via the REST API.
 * This restates the value of an existing conversion that was originally sent with $0.
 *
 * Conversions created through Data Manager can only be matched by orderId (the
 * transactionId they were uploaded with); gclid + conversionDateTime returns
 * CONVERSION_NOT_FOUND for them. So orderId is used whenever it's known, and
 * gclid + conversionDateTime only for conversions without one.
 *
 * @param {object} params
 * @param {string} params.gclid - The Google Click ID from the original ad click
 * @param {string} params.conversionDateTime - ISO 8601 datetime of the original conversion
 * @param {number} params.adjustedValue - The new dollar value to set
 * @param {string} [params.orderId] - transactionId the conversion was uploaded with (CallRail call id)
 * @param {string} [params.conversionActionId] - Conversion action resource name (defaults to GOOGLE_ADS_CONVERSION_ACTION_ID)
 * @returns {Promise<boolean>} true if successful
 */
export async function uploadConversionAdjustment({
  gclid,
  conversionDateTime,
  adjustedValue,
  orderId,
  conversionActionId = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID,
}) {
  if (!process.env.GOOGLE_ADS_CUSTOMER_ID || !conversionActionId) {
    console.warn(
      "GoogleAds: Missing GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_CONVERSION_ACTION_ID, skipping adjustment",
    );
    return false;
  }

  if (!gclid && !orderId) {
    console.log(
      "GoogleAds: No GCLID or orderId provided, skipping conversion adjustment",
    );
    return false;
  }

  try {
    const accessToken = await getAccessToken();
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
    const formattedDateTime = formatDateTimeForGoogleAds(conversionDateTime);
    const adjustmentDateTime = formatDateTimeForGoogleAds(
      new Date().toISOString(),
    );

    console.log(
      `GoogleAds: Uploading conversion adjustment — gclid=${gclid} value=$${adjustedValue} ${orderId ? `orderId=${orderId}` : `datetime=${formattedDateTime}`}`,
    );

    const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}:uploadConversionAdjustments`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
          ? { "login-customer-id": process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID }
          : {}),
      },
      body: JSON.stringify({
        conversionAdjustments: [
          {
            conversionAction: conversionActionId,
            adjustmentType: "RESTATEMENT",
            ...(orderId
              ? { orderId }
              : {
                  gclidDateTimePair: {
                    gclid: gclid,
                    conversionDateTime: formattedDateTime,
                  },
                }),
            adjustmentDateTime: adjustmentDateTime,
            restatementValue: {
              adjustedValue: adjustedValue,
            },
          },
        ],
        partialFailure: true,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error(
        `GoogleAds: API returned ${response.status}:`,
        JSON.stringify(result),
      );
      Sentry.captureMessage("GoogleAds: Conversion adjustment API error", {
        level: "error",
        extra: {
          gclid,
          orderId,
          conversionDateTime: formattedDateTime,
          adjustedValue,
          result,
        },
      });
      return false;
    }

    if (result.partialFailureError) {
      const errorJson = JSON.stringify(result.partialFailureError);
      const isConversionNotFound = errorJson.includes("CONVERSION_NOT_FOUND");

      if (isConversionNotFound) {
        console.warn(
          `GoogleAds: Conversion not found for gclid=${gclid}${orderId ? ` orderId=${orderId}` : ""} — it may never have been uploaded to Google Ads`,
        );
      } else {
        console.error(
          "GoogleAds: Partial failure in conversion adjustment:",
          errorJson,
        );
        Sentry.captureMessage(
          "GoogleAds: Conversion adjustment partial failure",
          {
            level: "error",
            extra: {
              gclid,
              orderId,
              conversionDateTime: formattedDateTime,
              adjustedValue,
              error: result.partialFailureError,
            },
          },
        );
      }
      return isConversionNotFound ? "CONVERSION_NOT_FOUND" : false;
    }

    console.log(
      `GoogleAds: Successfully uploaded conversion adjustment for gclid=${gclid} value=$${adjustedValue}`,
    );
    return true;
  } catch (e) {
    Sentry.captureException(e);
    console.error("GoogleAds: Error uploading conversion adjustment:", e);
    return false;
  }
}

/**
 * Uploads a new click conversion to Google Ads via the Data Manager API
 * (events:ingest). Google Ads API UploadClickConversions is closed to new
 * integrations (CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE).
 * Phone Call conversions are created with a $0 value; the real value is restated
 * later by uploadConversionAdjustment() once the customer pays.
 *
 * conversionDateTime MUST be the same source value (CallRail start_time) that the
 * restatement later sends, since Google Ads matches the two by gclid + datetime.
 *
 * @param {object} params
 * @param {string} params.gclid - The Google Click ID from the original ad click
 * @param {string} params.conversionDateTime - ISO 8601 datetime of the conversion (CallRail start_time)
 * @param {string} [params.transactionId] - Dedupe key (CallRail call id), makes retries idempotent
 * @param {string} [params.gbraid] - iOS app-to-web click ID, when there is no gclid
 * @param {string} [params.wbraid] - iOS web-to-web click ID, when there is no gclid
 * @param {number} [params.conversionValue] - Dollar value of the conversion (default 0)
 * @param {string} [params.conversionActionId] - Conversion action resource name (defaults to GOOGLE_ADS_CONVERSION_ACTION_ID)
 * @param {string} [params.eventSource] - Data Manager event source: "PHONE" (default) or "WEB"
 * @returns {Promise<{success: boolean, requestId: string|null, validateOnly: boolean}>}
 *   validateOnly is true when GOOGLE_DATA_MANAGER_VALIDATE_ONLY made this a dry run (nothing was created)
 */
export async function uploadClickConversion({
  gclid,
  gbraid,
  wbraid,
  conversionDateTime,
  transactionId,
  conversionValue = 0,
  conversionActionId = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID,
  eventSource = "PHONE",
}) {
  if (!process.env.GOOGLE_ADS_CUSTOMER_ID || !conversionActionId) {
    console.warn(
      "GoogleAds: Missing GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_CONVERSION_ACTION_ID, skipping click conversion",
    );
    return { success: false, requestId: null, validateOnly: false };
  }

  if (!gclid && !gbraid && !wbraid) {
    console.log("GoogleAds: No click ID provided, skipping click conversion");
    return { success: false, requestId: null, validateOnly: false };
  }

  // iOS clicks may carry only gbraid/wbraid; send whichever IDs exist
  const adIdentifiers = {
    ...(gclid ? { gclid } : {}),
    ...(gbraid ? { gbraid } : {}),
    ...(wbraid ? { wbraid } : {}),
  };
  const clickLabel = gclid
    ? `gclid=${gclid}`
    : gbraid
      ? `gbraid=${gbraid}`
      : `wbraid=${wbraid}`;

  if (!conversionDateTime || isNaN(new Date(conversionDateTime).getTime())) {
    console.warn(
      `GoogleAds: Invalid conversionDateTime "${conversionDateTime}" for ${clickLabel}, skipping click conversion`,
    );
    return { success: false, requestId: null, validateOnly: false };
  }

  try {
    const accessToken = await getAccessToken();
    const eventTimestamp = toEventTimestamp(conversionDateTime);
    const validateOnly =
      process.env.GOOGLE_DATA_MANAGER_VALIDATE_ONLY?.toUpperCase() === "TRUE";

    console.log(
      `GoogleAds: Uploading click conversion via Data Manager — ${clickLabel} value=$${conversionValue} datetime=${eventTimestamp} transactionId=${transactionId || "none"}${validateOnly ? " (validateOnly)" : ""}`,
    );

    const destination = {
      operatingAccount: {
        accountType: "GOOGLE_ADS",
        accountId: process.env.GOOGLE_ADS_CUSTOMER_ID,
      },
      // Data Manager wants the numeric conversion action ID, not the resource name
      productDestinationId: conversionActionId.split("/").pop(),
    };
    if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
      destination.loginAccount = {
        accountType: "GOOGLE_ADS",
        accountId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      };
    }

    const response = await fetch(DATA_MANAGER_INGEST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        destinations: [destination],
        events: [
          {
            adIdentifiers,
            eventTimestamp,
            ...(transactionId ? { transactionId } : {}),
            eventSource,
            conversionValue,
            currency: "USD",
          },
        ],
        ...(validateOnly ? { validateOnly: true } : {}),
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        `GoogleAds: Data Manager API returned ${response.status}:`,
        JSON.stringify(result),
      );
      Sentry.captureMessage("GoogleAds: Click conversion API error", {
        level: "error",
        extra: {
          gclid,
          conversionDateTime: eventTimestamp,
          transactionId,
          result,
        },
      });
      return { success: false, requestId: null, validateOnly };
    }

    if (result.fieldWarnings?.length) {
      console.warn(
        `GoogleAds: Data Manager field warnings for ${clickLabel}:`,
        JSON.stringify(result.fieldWarnings),
      );
    }

    console.log(
      `GoogleAds: Successfully uploaded click conversion for ${clickLabel} datetime=${eventTimestamp} transactionId=${transactionId || "none"} requestId=${result.requestId}${validateOnly ? " (validateOnly — not applied)" : ""}`,
    );
    return { success: true, requestId: result.requestId ?? null, validateOnly };
  } catch (e) {
    Sentry.captureException(e);
    console.error("GoogleAds: Error uploading click conversion:", e);
    return { success: false, requestId: null, validateOnly: false };
  }
}

/**
 * Lists all conversion actions in the account. Used for diagnostics.
 * @returns {Promise<object[]>} Array of conversion actions with id, name, type, and resource_name
 */
export async function listConversionActions() {
  const accessToken = await getAccessToken();
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
        ? { "login-customer-id": process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID }
        : {}),
    },
    body: JSON.stringify({
      query:
        "SELECT conversion_action.id, conversion_action.name, conversion_action.type, conversion_action.resource_name, conversion_action.status FROM conversion_action",
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `GoogleAds: Failed to list conversion actions (${response.status}): ${JSON.stringify(result)}`,
    );
  }

  // searchStream returns an array of batches
  const actions = [];
  for (const batch of result) {
    for (const row of batch.results || []) {
      actions.push({
        id: row.conversionAction.id,
        name: row.conversionAction.name,
        type: row.conversionAction.type,
        status: row.conversionAction.status,
        resourceName: row.conversionAction.resourceName,
      });
    }
  }
  return actions;
}

/**
 * Returns the Data Manager eventTimestamp for a conversion datetime: the same
 * whole second, in the same America/New_York offset, that the restatement
 * sends via formatDateTimeForGoogleAds(). e.g. "2026-09-23T13:42:24-04:00".
 * @param {string} isoDateTime - ISO 8601 datetime (e.g., CallRail start_time)
 * @returns {string}
 */
export function toEventTimestamp(isoDateTime) {
  return formatDateTimeForGoogleAds(isoDateTime).replace(" ", "T");
}

/**
 * Formats an ISO 8601 datetime string into Google Ads format.
 * Google Ads requires: "yyyy-MM-dd HH:mm:ss+/-HH:mm"
 * @param {string} isoDateTime - ISO 8601 datetime (e.g., "2026-03-22T14:30:00.000-04:00")
 * @returns {string} Formatted datetime
 */
function formatDateTimeForGoogleAds(isoDateTime) {
  const date = new Date(isoDateTime);
  const formatted = date.toLocaleString("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const tzName = date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
  const offset = tzName.includes("EDT") ? "-04:00" : "-05:00";

  return `${formatted}${offset}`;
}
