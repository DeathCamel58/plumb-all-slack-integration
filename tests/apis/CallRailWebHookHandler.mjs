import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();
const uploadConversionAdjustmentMock = jest.fn();
const sentryMock = { captureException: jest.fn() };

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: eventsEmitMock,
    on: eventsOnMock,
  },
}));

jest.unstable_mockModule("@sentry/node", () => sentryMock);

jest.unstable_mockModule("../../util/apis/GoogleAdsConversions.js", () => ({
  uploadConversionAdjustment: uploadConversionAdjustmentMock,
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

function makeReq(body) {
  return { body };
}

describe("CallRailWebHookHandler", () => {
  beforeEach(() => {
    uploadConversionAdjustmentMock.mockReset();
    sentryMock.captureException.mockReset();
  });

  describe("call-modified", () => {
    test("Value + GCLID → uploads conversion adjustment", async () => {
      uploadConversionAdjustmentMock.mockResolvedValue(true);

      await callModifiedHandler(
        makeReq({
          customer_phone_number: "+14045551234",
          value: "745.00",
          gclid: "abc123",
          start_time: "2026-03-22T14:30:00.000-04:00",
          source_name: "Google Ads",
        }),
      );

      expect(uploadConversionAdjustmentMock).toHaveBeenCalledTimes(1);
      expect(uploadConversionAdjustmentMock).toHaveBeenCalledWith({
        gclid: "abc123",
        conversionDateTime: "2026-03-22T14:30:00.000-04:00",
        adjustedValue: 745,
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

      expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
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

      expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
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

      expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
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

      expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
    });

    test("Upload error → Sentry captures, does not throw", async () => {
      uploadConversionAdjustmentMock.mockRejectedValue(
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
      uploadConversionAdjustmentMock.mockResolvedValue(true);

      await outboundCallModifiedHandler(
        makeReq({
          customer_phone_number: "+14045556666",
          value: "1200.00",
          gclid: "out-gclid-1",
          start_time: "2026-03-23T10:00:00.000-04:00",
          source_name: "Google Ads",
        }),
      );

      expect(uploadConversionAdjustmentMock).toHaveBeenCalledTimes(1);
      expect(uploadConversionAdjustmentMock).toHaveBeenCalledWith({
        gclid: "out-gclid-1",
        conversionDateTime: "2026-03-23T10:00:00.000-04:00",
        adjustedValue: 1200,
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

      expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
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

      expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
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
