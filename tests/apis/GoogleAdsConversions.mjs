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
    const CALL_ID = "CAL01a0cf5c8d9b70b88d5077becd270a9d";

    beforeEach(() => {
      delete process.env.GOOGLE_DATA_MANAGER_VALIDATE_ONLY;
      process.env.GOOGLE_ADS_REFRESH_TOKEN = "ads-refresh";
    });

    test("POSTs a $0 conversion to Data Manager events:ingest", async () => {
      mockApi(jsonResponse({ requestId: "req-1", fieldWarnings: [] }));

      const result = await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-09-23T13:42:24.157-04:00",
        transactionId: CALL_ID,
      });

      expect(result).toEqual({
        success: true,
        requestId: "req-1",
        validateOnly: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const { url, options, body } = apiCall();
      expect(url).toBe("https://datamanager.googleapis.com/v1/events:ingest");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer token-1");
      expect(options.headers).not.toHaveProperty("developer-token");
      expect(options.headers).not.toHaveProperty("login-customer-id");
      expect(body).toEqual({
        destinations: [
          {
            operatingAccount: {
              accountType: "GOOGLE_ADS",
              accountId: "1112223333",
            },
            loginAccount: {
              accountType: "GOOGLE_ADS",
              accountId: "4445556666",
            },
            productDestinationId: "987654321",
          },
        ],
        events: [
          {
            adIdentifiers: { gclid: "abc123" },
            eventTimestamp: "2026-09-23T13:42:24-04:00",
            transactionId: CALL_ID,
            eventSource: "PHONE",
            conversionValue: 0,
            currency: "USD",
          },
        ],
      });
    });

    test("Omits loginAccount when not configured", async () => {
      delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
      mockApi(jsonResponse({ requestId: "req-1" }));

      await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
        transactionId: CALL_ID,
      });

      expect(apiCall().body.destinations[0]).not.toHaveProperty("loginAccount");
    });

    test("Uses GOOGLE_ADS_REFRESH_TOKEN", async () => {
      mockApi(jsonResponse({ requestId: "req-1" }));

      await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
        transactionId: CALL_ID,
      });

      const tokenBody = fetchMock.mock.calls[0][1].body;
      expect(tokenBody.get("refresh_token")).toBe("ads-refresh");
    });

    test.each([
      ["2026-09-23T13:42:24.157-04:00", "2026-09-23T13:42:24-04:00"], // EDT, ms dropped
      ["2026-11-12T09:05:07.999-05:00", "2026-11-12T09:05:07-05:00"], // EST
      ["2026-03-22T18:30:00.000Z", "2026-03-22T14:30:00-04:00"], // UTC input
      ["2026-11-01T05:30:00Z", "2026-11-01T01:30:00-04:00"], // DST fall-back day
    ])(
      "eventTimestamp for start_time=%s is %s and matches the restatement's second",
      async (startTime, expected) => {
        mockApi(jsonResponse({ requestId: "req-1" }));
        await uploadClickConversion({
          gclid: "abc123",
          conversionDateTime: startTime,
          transactionId: CALL_ID,
        });
        const created = apiCall().body.events[0].eventTimestamp;
        expect(created).toBe(expected);

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

        expect(created).toBe(restated.replace(" ", "T"));
        expect(new Date(created).getTime()).toBe(
          new Date(restated.replace(" ", "T")).getTime(),
        );
        expect(new Date(created).getTime()).toBe(
          Math.floor(new Date(startTime).getTime() / 1000) * 1000,
        );
      },
    );

    test("GOOGLE_DATA_MANAGER_VALIDATE_ONLY=TRUE → validateOnly: true", async () => {
      process.env.GOOGLE_DATA_MANAGER_VALIDATE_ONLY = "TRUE";
      mockApi(jsonResponse({ requestId: "req-1" }));

      const result = await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
        transactionId: CALL_ID,
      });

      expect(result).toMatchObject({ success: true, validateOnly: true });
      expect(apiCall().body.validateOnly).toBe(true);
    });

    test("validateOnly is omitted by default", async () => {
      mockApi(jsonResponse({ requestId: "req-1" }));

      await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
        transactionId: CALL_ID,
      });

      expect(apiCall().body).not.toHaveProperty("validateOnly");
    });

    test("Logs the requestId on success", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      mockApi(jsonResponse({ requestId: "req-xyz", fieldWarnings: [] }));

      await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
        transactionId: CALL_ID,
      });

      expect(
        logSpy.mock.calls.some(([msg]) => String(msg).includes("req-xyz")),
      ).toBe(true);
      logSpy.mockRestore();
    });

    test("Missing env vars → returns false without calling the API", async () => {
      delete process.env.GOOGLE_ADS_CONVERSION_ACTION_ID;

      const result = await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
        transactionId: CALL_ID,
      });

      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("No GCLID → returns false without calling the API", async () => {
      const result = await uploadClickConversion({
        gclid: null,
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
        transactionId: CALL_ID,
      });

      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("Invalid datetime → returns false without calling the API", async () => {
      const result = await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: undefined,
        transactionId: CALL_ID,
      });

      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("HTTP error → returns false and reports to Sentry", async () => {
      mockApi(
        jsonResponse(
          {
            error: {
              code: 400,
              message: "Invalid argument",
              status: "INVALID_ARGUMENT",
            },
          },
          false,
          400,
        ),
      );

      const result = await uploadClickConversion({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
        transactionId: CALL_ID,
      });

      expect(result.success).toBe(false);
      expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
    });

    test("Non-JSON error body → returns false and reports to Sentry", async () => {
      mockApi({
        ok: false,
        status: 503,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      });

      await expect(
        uploadClickConversion({
          gclid: "abc123",
          conversionDateTime: "2026-03-22T14:30:00.000-04:00",
          transactionId: CALL_ID,
        }),
      ).resolves.toMatchObject({ success: false });
      expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
    });

    test("OAuth failure → returns false, Sentry captures, does not throw", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "invalid_scope" }, false, 400),
      );

      await expect(
        uploadClickConversion({
          gclid: "abc123",
          conversionDateTime: "2026-03-22T14:30:00.000-04:00",
          transactionId: CALL_ID,
        }),
      ).resolves.toMatchObject({ success: false });
      expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    });

    test("Network error → returns false and does not throw", async () => {
      fetchMock.mockRejectedValue(new Error("ECONNRESET"));

      await expect(
        uploadClickConversion({
          gclid: "abc123",
          conversionDateTime: "2026-03-22T14:30:00.000-04:00",
          transactionId: CALL_ID,
        }),
      ).resolves.toMatchObject({ success: false });
      expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    });
  });
});
