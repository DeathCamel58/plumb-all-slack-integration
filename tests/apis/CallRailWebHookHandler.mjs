import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();
const restateClickConversionMock = jest.fn();
const uploadClickConversionMock = jest.fn();
const claimClickConversionMock = jest.fn();
const markClickConversionUploadedMock = jest.fn();
const releaseClickConversionMock = jest.fn();
const sentryMock = { captureException: jest.fn() };

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: eventsEmitMock,
    on: eventsOnMock,
  },
}));

jest.unstable_mockModule("@sentry/node", () => sentryMock);

jest.unstable_mockModule("../../util/apis/GoogleAdsConversions.js", () => ({
  uploadClickConversion: uploadClickConversionMock,
}));

jest.unstable_mockModule("../../util/apis/GoogleAdsClickTracking.js", () => ({
  claimClickConversion: claimClickConversionMock,
  markClickConversionUploaded: markClickConversionUploadedMock,
  releaseClickConversion: releaseClickConversionMock,
  restateClickConversion: restateClickConversionMock,
}));

await import("../../util/apis/CallRailWebHookHandler.js");

// Extract handlers registered via events.on()
function getHandler(eventName) {
  const call = eventsOnMock.mock.calls.find(([name]) => name === eventName);
  if (!call) throw new Error(`No handler registered for ${eventName}`);
  return call[1];
}

const callModifiedHandler = getHandler("callrail-call-modified");
const outboundCallModifiedHandler = getHandler(
  "callrail-outbound-call-modified",
);
const postCallHandler = getHandler("callrail-post-call");

function makeReq(body) {
  return { body };
}

describe("CallRailWebHookHandler", () => {
  beforeEach(() => {
    restateClickConversionMock.mockReset();
    uploadClickConversionMock.mockReset();
    uploadClickConversionMock.mockResolvedValue({
      success: true,
      requestId: "req-1",
      validateOnly: false,
    });
    claimClickConversionMock.mockReset();
    claimClickConversionMock.mockResolvedValue({
      status: "claimed",
      conversionDateTime: "2026-03-22T14:30:00-04:00",
    });
    markClickConversionUploadedMock.mockReset();
    releaseClickConversionMock.mockReset();
    delete process.env.GOOGLE_ADS_MIN_CALL_DURATION;
    sentryMock.captureException.mockReset();
  });

  describe("call-modified", () => {
    test("Value + GCLID → uploads conversion adjustment", async () => {
      restateClickConversionMock.mockResolvedValue(true);

      await callModifiedHandler(
        makeReq({
          customer_phone_number: "+14045551234",
          resource_id: "CAL0000000000000000000000000000003",
          value: "745.00",
          gclid: "abc123",
          start_time: "2026-03-22T14:30:00.000-04:00",
          source_name: "Google Ads",
        }),
      );

      expect(restateClickConversionMock).toHaveBeenCalledTimes(1);
      expect(restateClickConversionMock).toHaveBeenCalledWith({
        gclid: "abc123",
        startTime: "2026-03-22T14:30:00.000-04:00",
        value: 745,
        callId: "CAL0000000000000000000000000000003",
      });
    });

    test("Value + GCLID from Google Ads Assets → skips adjustment", async () => {
      await callModifiedHandler(
        makeReq({
          customer_phone_number: "+14045559999",
          value: "4485.00",
          gclid: "CjwKCAjwAssetGCLID",
          start_time: "2026-04-12T16:32:24.975-04:00",
          source_name: "Google Ads Assets",
        }),
      );

      expect(restateClickConversionMock).not.toHaveBeenCalled();
    });

    test("Value but no GCLID → does not upload", async () => {
      await callModifiedHandler(
        makeReq({
          customer_phone_number: "+14045552222",
          value: "500.00",
          gclid: "",
          start_time: "2026-03-22T14:30:00.000-04:00",
          source_name: "Direct",
        }),
      );

      expect(restateClickConversionMock).not.toHaveBeenCalled();
    });

    test("GCLID but no value → does not upload", async () => {
      await callModifiedHandler(
        makeReq({
          customer_phone_number: "+14045553333",
          value: "",
          gclid: "abc123",
          start_time: "2026-03-22T14:30:00.000-04:00",
        }),
      );

      expect(restateClickConversionMock).not.toHaveBeenCalled();
    });

    test("No value, no GCLID → does not upload", async () => {
      await callModifiedHandler(
        makeReq({
          customer_phone_number: "+14045554444",
          value: null,
          gclid: null,
          start_time: "2026-03-22T14:30:00.000-04:00",
        }),
      );

      expect(restateClickConversionMock).not.toHaveBeenCalled();
    });

    test("Upload error → Sentry captures, does not throw", async () => {
      restateClickConversionMock.mockRejectedValue(
        new Error("Google Ads API error"),
      );

      await callModifiedHandler(
        makeReq({
          customer_phone_number: "+14045555555",
          value: "100.00",
          gclid: "xyz789",
          start_time: "2026-03-22T14:30:00.000-04:00",
        }),
      );

      expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    });
  });

  describe("outbound-call-modified", () => {
    test("Value + GCLID → uploads conversion adjustment", async () => {
      restateClickConversionMock.mockResolvedValue(true);

      await outboundCallModifiedHandler(
        makeReq({
          customer_phone_number: "+14045556666",
          value: "1200.00",
          gclid: "out-gclid-1",
          start_time: "2026-03-23T10:00:00.000-04:00",
          source_name: "Google Ads",
        }),
      );

      expect(restateClickConversionMock).toHaveBeenCalledTimes(1);
      expect(restateClickConversionMock).toHaveBeenCalledWith({
        gclid: "out-gclid-1",
        startTime: "2026-03-23T10:00:00.000-04:00",
        value: 1200,
        callId: undefined,
      });
    });

    test("Value + GCLID from Google Ads Assets → skips adjustment", async () => {
      await outboundCallModifiedHandler(
        makeReq({
          customer_phone_number: "+14045557777",
          value: "800.00",
          gclid: "out-asset-gclid",
          start_time: "2026-03-23T10:00:00.000-04:00",
          source_name: "Google Ads Assets",
        }),
      );

      expect(restateClickConversionMock).not.toHaveBeenCalled();
    });

    test("No GCLID → does not upload", async () => {
      await outboundCallModifiedHandler(
        makeReq({
          customer_phone_number: "+14045558888",
          value: "500.00",
          gclid: "",
          start_time: "2026-03-23T10:00:00.000-04:00",
        }),
      );

      expect(restateClickConversionMock).not.toHaveBeenCalled();
    });
  });

  describe("post-call", () => {
    // CallRail webhook payloads carry the call id as `resource_id`; there is no `id` field.
    const baseCall = {
      resource_id: "CAL01a0cf5c8d9b70b88d5077becd270a9d",
      customer_phone_number: "+14045551234",
      direction: "inbound",
      duration: 75,
      gclid: "abc123",
      start_time: "2026-03-22T14:30:00.000-04:00",
      source_name: "Google Ads",
    };

    test("75s call with GCLID → uploads click conversion with start_time and call id", async () => {
      await postCallHandler(makeReq({ ...baseCall }));

      expect(uploadClickConversionMock).toHaveBeenCalledTimes(1);
      expect(uploadClickConversionMock).toHaveBeenCalledWith({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
        transactionId: "CAL01a0cf5c8d9b70b88d5077becd270a9d",
      });
    });

    test("Exactly 60s → uploads", async () => {
      await postCallHandler(makeReq({ ...baseCall, duration: 60 }));
      expect(uploadClickConversionMock).toHaveBeenCalledTimes(1);
    });

    test("59s call → does not upload", async () => {
      await postCallHandler(makeReq({ ...baseCall, duration: 59 }));
      expect(uploadClickConversionMock).not.toHaveBeenCalled();
    });

    test("Missing duration → does not upload", async () => {
      await postCallHandler(makeReq({ ...baseCall, duration: undefined }));
      expect(uploadClickConversionMock).not.toHaveBeenCalled();
    });

    test("60s+ call with no GCLID → does not upload", async () => {
      await postCallHandler(makeReq({ ...baseCall, gclid: "" }));
      expect(uploadClickConversionMock).not.toHaveBeenCalled();
    });

    test("60s+ call from Google Ads Assets → does not upload", async () => {
      await postCallHandler(
        makeReq({ ...baseCall, source_name: "Google Ads Assets" }),
      );
      expect(uploadClickConversionMock).not.toHaveBeenCalled();
    });

    test("Outbound direction → does not upload", async () => {
      await postCallHandler(makeReq({ ...baseCall, direction: "outbound" }));
      expect(uploadClickConversionMock).not.toHaveBeenCalled();
    });

    test("GOOGLE_ADS_MIN_CALL_DURATION overrides the threshold", async () => {
      process.env.GOOGLE_ADS_MIN_CALL_DURATION = "90";
      await postCallHandler(makeReq({ ...baseCall, duration: 75 }));
      expect(uploadClickConversionMock).not.toHaveBeenCalled();

      await postCallHandler(makeReq({ ...baseCall, duration: 90 }));
      expect(uploadClickConversionMock).toHaveBeenCalledTimes(1);
    });

    test("Upload error → Sentry captures, does not throw", async () => {
      uploadClickConversionMock.mockRejectedValue(new Error("boom"));

      await expect(
        postCallHandler(makeReq({ ...baseCall })),
      ).resolves.toBeUndefined();
      expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    });

    test("Outbound post-call remains a stub", async () => {
      const outboundPostCallHandler = getHandler("callrail-outbound-post-call");
      await outboundPostCallHandler(makeReq({ ...baseCall }));
      expect(uploadClickConversionMock).not.toHaveBeenCalled();
    });

    describe("one conversion per GCLID", () => {
      test("First call on a new GCLID → claims, uploads once, records requestId", async () => {
        await postCallHandler(makeReq({ ...baseCall }));

        expect(claimClickConversionMock).toHaveBeenCalledWith({
          gclid: "abc123",
          transactionId: "CAL01a0cf5c8d9b70b88d5077becd270a9d",
          startTime: "2026-03-22T14:30:00.000-04:00",
        });
        expect(uploadClickConversionMock).toHaveBeenCalledTimes(1);
        expect(markClickConversionUploadedMock).toHaveBeenCalledWith(
          "abc123",
          "req-1",
        );
        expect(releaseClickConversionMock).not.toHaveBeenCalled();
      });

      test("Repeat call on an already-converted GCLID → no upload, logs SKIP", async () => {
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
        claimClickConversionMock.mockResolvedValue({
          status: "duplicate",
          existing: { transactionId: "CALfirst" },
        });

        await postCallHandler(
          makeReq({ ...baseCall, resource_id: "CALsecond" }),
        );

        expect(uploadClickConversionMock).not.toHaveBeenCalled();
        expect(
          logSpy.mock.calls.some(([msg]) =>
            String(msg).includes(
              "reason=repeat call on gclid already converted (first call transactionId=CALfirst)",
            ),
          ),
        ).toBe(true);
        logSpy.mockRestore();
      });

      test("Upload failure → releases the claim", async () => {
        uploadClickConversionMock.mockResolvedValue({
          success: false,
          requestId: null,
          validateOnly: false,
        });

        await postCallHandler(makeReq({ ...baseCall }));

        expect(markClickConversionUploadedMock).not.toHaveBeenCalled();
        expect(releaseClickConversionMock).toHaveBeenCalledWith(
          "abc123",
          "CAL01a0cf5c8d9b70b88d5077becd270a9d",
        );
      });

      test("Upload throws → releases the claim, Sentry captures, does not throw", async () => {
        uploadClickConversionMock.mockRejectedValue(new Error("boom"));

        await expect(
          postCallHandler(makeReq({ ...baseCall })),
        ).resolves.toBeUndefined();
        expect(releaseClickConversionMock).toHaveBeenCalledTimes(1);
        expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
      });

      test("validateOnly dry run → releases the claim so a real upload can happen later", async () => {
        uploadClickConversionMock.mockResolvedValue({
          success: true,
          requestId: "v-1",
          validateOnly: true,
        });

        await postCallHandler(makeReq({ ...baseCall }));

        expect(markClickConversionUploadedMock).not.toHaveBeenCalled();
        expect(releaseClickConversionMock).toHaveBeenCalledTimes(1);
      });

      test("Store unavailable (e.g. missing table) → uploads anyway without tracking", async () => {
        claimClickConversionMock.mockResolvedValue({ status: "unavailable" });

        await postCallHandler(makeReq({ ...baseCall }));

        expect(uploadClickConversionMock).toHaveBeenCalledTimes(1);
        expect(markClickConversionUploadedMock).not.toHaveBeenCalled();
        expect(releaseClickConversionMock).not.toHaveBeenCalled();
      });

      test("Invalid start_time → no claim, upload still attempted (and rejects it)", async () => {
        await postCallHandler(makeReq({ ...baseCall, start_time: "garbage" }));

        expect(claimClickConversionMock).not.toHaveBeenCalled();
        expect(uploadClickConversionMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("stub handlers register", () => {
    test("All 8 webhook types have registered handlers", () => {
      const registeredEvents = eventsOnMock.mock.calls.map(([name]) => name);

      expect(registeredEvents).toContain("callrail-call-modified");
      expect(registeredEvents).toContain("callrail-outbound-call-modified");
      expect(registeredEvents).toContain("callrail-pre-call");
      expect(registeredEvents).toContain("callrail-call-routing-complete");
      expect(registeredEvents).toContain("callrail-post-call");
      expect(registeredEvents).toContain("callrail-outbound-post-call");
      expect(registeredEvents).toContain("callrail-text-message-sent");
      expect(registeredEvents).toContain("callrail-text-message-received");
    });
  });
});
