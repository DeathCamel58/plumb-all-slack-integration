import fetch from "node-fetch";
import * as Sentry from "@sentry/node";

const GOOGLE_ADS_API_VERSION = "v23";

/**
 * Gets a fresh OAuth2 access token using the refresh token.
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
 * @param {object} params
 * @param {string} params.gclid - The Google Click ID from the original ad click
 * @param {string} params.conversionDateTime - ISO 8601 datetime of the original conversion
 * @param {number} params.adjustedValue - The new dollar value to set
 * @returns {Promise<boolean>} true if successful
 */
export async function uploadConversionAdjustment({
  gclid,
  conversionDateTime,
  adjustedValue,
}) {
  if (
    !process.env.GOOGLE_ADS_CUSTOMER_ID ||
    !process.env.GOOGLE_ADS_CONVERSION_ACTION_ID
  ) {
    console.warn(
      "GoogleAds: Missing GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_CONVERSION_ACTION_ID, skipping adjustment",
    );
    return false;
  }

  if (!gclid) {
    console.log("GoogleAds: No GCLID provided, skipping conversion adjustment");
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
      `GoogleAds: Uploading conversion adjustment — gclid=${gclid} value=$${adjustedValue} datetime=${formattedDateTime}`,
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
            conversionAction: process.env.GOOGLE_ADS_CONVERSION_ACTION_ID,
            adjustmentType: "RESTATEMENT",
            gclidDateTimePair: {
              gclid: gclid,
              conversionDateTime: formattedDateTime,
            },
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
          `GoogleAds: Conversion not found for gclid=${gclid} — CallRail may not have sent this conversion to Google Ads`,
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
