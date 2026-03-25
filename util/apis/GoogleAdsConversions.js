import { GoogleAdsApi } from "google-ads-api";
import * as Sentry from "@sentry/node";

let clientInstance = null;

/**
 * Returns a lazily-initialized Google Ads API client.
 * @returns {GoogleAdsApi}
 */
function getClient() {
  if (!clientInstance) {
    clientInstance = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });
  }
  return clientInstance;
}

/**
 * Uploads a conversion value adjustment to Google Ads.
 * This restates the value of an existing conversion that was originally sent with $0.
 *
 * @param {object} params
 * @param {string} params.gclid - The Google Click ID from the original ad click
 * @param {string} params.conversionDateTime - ISO 8601 datetime of the original conversion (must match exactly)
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
    const client = getClient();
    const customer = client.Customer({
      customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    });

    // Google Ads requires the datetime in "yyyy-MM-dd HH:mm:ss+/-HH:mm" format
    const formattedDateTime = formatDateTimeForGoogleAds(conversionDateTime);

    console.log(
      `GoogleAds: Uploading conversion adjustment — gclid=${gclid} value=$${adjustedValue} datetime=${formattedDateTime}`,
    );

    const response = await customer.conversionAdjustments.upload(
      [
        {
          adjustment_type: "RESTATEMENT",
          conversion_action: process.env.GOOGLE_ADS_CONVERSION_ACTION_ID,
          gclid_date_time_pair: {
            gclid: gclid,
            conversion_date_time: formattedDateTime,
          },
          restatement_value: {
            adjusted_value: adjustedValue,
            currency_code: "USD",
          },
        },
      ],
      {
        partial_failure: true,
      },
    );

    if (response.partial_failure_error) {
      console.error(
        "GoogleAds: Partial failure in conversion adjustment:",
        JSON.stringify(response.partial_failure_error),
      );
      Sentry.captureMessage(
        "GoogleAds: Conversion adjustment partial failure",
        {
          level: "error",
          extra: {
            gclid,
            conversionDateTime: formattedDateTime,
            adjustedValue,
            error: response.partial_failure_error,
          },
        },
      );
      return false;
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
 * Formats an ISO 8601 datetime string into Google Ads format.
 * Google Ads requires: "yyyy-MM-dd HH:mm:ss+/-HH:mm"
 * @param {string} isoDateTime - ISO 8601 datetime (e.g., "2026-03-22T14:30:00.000-04:00")
 * @returns {string} Formatted datetime
 */
function formatDateTimeForGoogleAds(isoDateTime) {
  const date = new Date(isoDateTime);
  // Format in Eastern Time since all our calls are Eastern
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

  // sv-SE locale gives "yyyy-MM-dd HH:mm:ss" — just need to add the offset
  // Determine if Eastern is EDT (-04:00) or EST (-05:00)
  const offsetMinutes = date.getTimezoneOffset();
  // getTimezoneOffset returns minutes for the local machine, but we need Eastern
  // Use a different approach: format with timeZoneName to detect
  const tzName = date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
  const offset = tzName.includes("EDT") ? "-04:00" : "-05:00";

  return `${formatted}${offset}`;
}
