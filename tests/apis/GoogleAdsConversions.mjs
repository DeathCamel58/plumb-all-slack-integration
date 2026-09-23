import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const fetchMock = jest.fn();
const sentryMock = {
  captureException: jest.fn(),
  captureMessage: jest.fn(),
};

jest.unstable_mockModule("node-fetch", () => ({ default: fetchMock }));
jest.unstable_mockModule("@sentry/node", () => sentryMock);

const { uploadClickConversion, uploadConversionAdjustment } = await import(
  "../../util/apis/GoogleAdsConversions.js"
);

const CONVERSION_ACTION = "customers/1234567890/conversionActions/987654321";

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/**
 * Queues an OAuth token response followed by the given API response.
 */
function mockApi(apiResponse) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ access_token: "token-1" }))
    .mockResolvedValueOnce(apiResponse);
}

function apiCall() {
  const [url, options] = fetchMock.mock.calls[1];
  return { url, options, body: JSON.parse(options.body) };
}

describe("GoogleAdsConversions", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    sentryMock.captureException.mockReset();
    sentryMock.captureMessage.mockReset();
    process.env.GOOGLE_ADS_CUSTOMER_ID = "1112223333";
    process.env.GOOGLE_ADS_CONVERSION_ACTION_ID = CONVERSION_ACTION;
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "4445556666";
  });

  describe("uploadClickConversion", () => {
    test("POSTs a $0 conversion to :uploadClickConversions", async () => {
      mockApi(jsonResponse({ results: [{}] }));

      const result = await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
      });

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const { url, options, body } = apiCall();
      expect(url).toBe(
        "https://googleads.googleapis.com/v23/customers/1112223333:uploadClickConversions",
      );
      expect(options.method).toBe("POST");
      expect(options.headers["developer-token"]).toBe("dev-token");
      expect(options.headers["login-customer-id"]).toBe("4445556666");
      expect(body).toEqual({
        conversions: [
          {
            gclid: "abc123",
            conversionAction: CONVERSION_ACTION,
            conversionDateTime: "2026-03-22 14:30:00-04:00",
            conversionValue: 0,
            currencyCode: "USD",
          },
        ],
        partialFailure: true,
      });
    });

    test("Omits login-customer-id when not configured", async () => {
      delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
      mockApi(jsonResponse({ results: [{}] }));

      await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
      });

      expect(apiCall().options.headers).not.toHaveProperty("login-customer-id");
    });

    test.each([
      "2026-03-22T14:30:00.000-04:00", // EDT
      "2026-01-15T09:05:07.123-05:00", // EST
      "2026-11-01T05:30:00Z", // DST fall-back day
    ])(
      "Datetime matches what the restatement sends for start_time=%s",
      async (startTime) => {
        mockApi(jsonResponse({ results: [{}] }));
        await uploadClickConversion({
          gclid: "abc123",
          conversionDateTime: startTime,
        });
        const created = apiCall().body.conversions[0].conversionDateTime;

        fetchMock.mockReset();
        mockApi(jsonResponse({ results: [{}] }));
        await uploadConversionAdjustment({
          gclid: "abc123",
          conversionDateTime: startTime,
          adjustedValue: 500,
        });
        const restated =
          apiCall().body.conversionAdjustments[0].gclidDateTimePair
            .conversionDateTime;

        expect(created).toBe(restated);
      },
    );

    test("Missing env vars → returns false without calling the API", async () => {
      delete process.env.GOOGLE_ADS_CONVERSION_ACTION_ID;

      const result = await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
      });

      expect(result).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("No GCLID → returns false without calling the API", async () => {
      const result = await uploadClickConversion({
        gclid: null,
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
      });

      expect(result).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("Invalid datetime → returns false without calling the API", async () => {
      const result = await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: undefined,
      });

      expect(result).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("HTTP error → returns false and reports to Sentry", async () => {
      mockApi(jsonResponse({ error: { message: "bad" } }, false, 400));

      const result = await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
      });

      expect(result).toBe(false);
      expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
    });

    test("Partial failure → returns false and reports to Sentry", async () => {
      mockApi(
        jsonResponse({
          partialFailureError: {
            code: 3,
            message: "The click is too old",
            details: [
              {
                errors: [
                  { errorCode: { conversionUploadError: "EXPIRED_EVENT" } },
                ],
              },
            ],
          },
          results: [{}],
        }),
      );

      const result = await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
      });

      expect(result).toBe(false);
      expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
    });

    test("Duplicate conversion → returns false without Sentry noise", async () => {
      mockApi(
        jsonResponse({
          partialFailureError: {
            code: 3,
            details: [
              {
                errors: [
                  {
                    errorCode: {
                      conversionUploadError: "CLICK_CONVERSION_ALREADY_EXISTS",
                    },
                  },
                ],
              },
            ],
          },
        }),
      );

      const result = await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
      });

      expect(result).toBe(false);
      expect(sentryMock.captureMessage).not.toHaveBeenCalled();
    });

    test("Network error → returns false and does not throw", async () => {
      fetchMock.mockRejectedValue(new Error("ECONNRESET"));

      await expect(
        uploadClickConversion({
          gclid: "abc123",
          conversionDateTime: "2026-03-22T14:30:00.000-04:00",
        }),
      ).resolves.toBe(false);
      expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    });
  });
});
