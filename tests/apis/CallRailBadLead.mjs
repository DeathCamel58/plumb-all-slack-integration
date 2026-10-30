import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const sentryMock = { captureException: jest.fn() };
const markCallNotALeadMock = jest.fn();
const uploadConversionAdjustmentMock = jest.fn();
const clickModel = {
  findFirst: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};
const assetModel = {
  findFirst: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};

jest.unstable_mockModule("@sentry/node", () => sentryMock);
jest.unstable_mockModule("../../util/prismaClient.js", () => ({
  default: {
    googleAdsClickConversion: clickModel,
    googleAdsAssetCallValue: assetModel,
  },
}));
jest.unstable_mockModule("../../util/apis/CallRail.js", () => ({
  markCallNotALead: markCallNotALeadMock,
}));
jest.unstable_mockModule("../../util/apis/GoogleAdsConversions.js", () => ({
  uploadConversionAdjustment: uploadConversionAdjustmentMock,
}));

const { callIdFromCallRailMessage, markCallBadLead, retryPendingRetractions } =
  await import("../../util/apis/CallRailBadLead.js");

const CLICK_ACTION = "customers/1/conversionActions/7135140411";
const ASSET_ACTION = "customers/1/conversionActions/555";

/** Each test uses its own call id, since handled calls are remembered */
let callNumber = 0;
const nextCallId = () => `CAL0${(++callNumber).toString(16)}`;

function clickRow(callId, overrides = {}) {
  return {
    gclid: "Cj0-click",
    transactionId: callId,
    conversionDateTime: "2026-10-29T09:10:11-04:00",
    uploadedAt: new Date("2026-10-29T13:11:00Z"),
    retractRequestedAt: null,
    retractedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.GOOGLE_ADS_RETRACTION_VALIDATE_ONLY;
  process.env.GOOGLE_ADS_CONVERSION_ACTION_ID = CLICK_ACTION;
  process.env.GOOGLE_ADS_ASSET_VALUE_CONVERSION_ACTION_ID = ASSET_ACTION;
  markCallNotALeadMock.mockResolvedValue({ id: "updated" });
  clickModel.findFirst.mockResolvedValue(null);
  assetModel.findFirst.mockResolvedValue(null);
  clickModel.updateMany.mockResolvedValue({ count: 1 });
  assetModel.updateMany.mockResolvedValue({ count: 1 });
});

describe("callIdFromCallRailMessage", () => {
  test("reads the call id from a New Call post's link", () => {
    expect(
      callIdFromCallRailMessage(
        "&gt; *New Call* - <https://app.callrail.com/analytics/a/1/events/PER01a?event_id=CAL01a1892776bb7d&amp;event_type=call|Plumb-All> (4s)",
      ),
    ).toBe("CAL01a1892776bb7d");
  });

  test("text message posts and other messages have no call", () => {
    expect(
      callIdFromCallRailMessage(
        "&gt; *Text Message Received* - Plumb-All\n&gt;From: *<https://app.callrail.com/x?event_id=MSG01a&amp;event_type=sms_thread|+1>*",
      ),
    ).toBeNull();
    expect(callIdFromCallRailMessage("hello")).toBeNull();
    expect(callIdFromCallRailMessage(undefined)).toBeNull();
  });
});

describe("markCallBadLead", () => {
  test("marks the call not a lead and retracts its click conversion", async () => {
    const callId = nextCallId();
    clickModel.findFirst.mockResolvedValue(clickRow(callId));
    uploadConversionAdjustmentMock.mockResolvedValue(true);

    const result = await markCallBadLead({ callId, trigger: "X reaction" });

    expect(markCallNotALeadMock).toHaveBeenCalledWith(
      callId,
      "Marked not a lead from Slack (X reaction)",
    );
    expect(clickModel.findFirst).toHaveBeenCalledWith({
      where: { transactionId: callId },
    });
    expect(clickModel.updateMany).toHaveBeenCalledWith({
      where: { gclid: "Cj0-click", retractRequestedAt: null },
      data: { retractRequestedAt: expect.any(Date) },
    });
    expect(uploadConversionAdjustmentMock).toHaveBeenCalledWith({
      gclid: "Cj0-click",
      conversionDateTime: "2026-10-29T09:10:11-04:00",
      orderId: callId,
      conversionActionId: CLICK_ACTION,
      adjustmentType: "RETRACTION",
      validateOnly: false,
    });
    expect(clickModel.update).toHaveBeenCalledWith({
      where: { gclid: "Cj0-click" },
      data: { retractedAt: expect.any(Date) },
    });
    expect(result).toEqual({
      duplicate: false,
      callRail: "marked",
      conversions: [{ label: "call conversion", status: "retracted" }],
      validateOnly: false,
    });
  });

  test("a call-asset call's value is retracted on the asset action", async () => {
    const callId = nextCallId();
    assetModel.findFirst.mockResolvedValue({
      callId,
      gclid: "Cj0-asset",
      conversionDateTime: "2026-10-29T09:10:11-04:00",
      uploadedAt: new Date(),
      retractedAt: null,
    });
    uploadConversionAdjustmentMock.mockResolvedValue(true);

    const result = await markCallBadLead({ callId, trigger: "X reaction" });

    expect(uploadConversionAdjustmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: callId,
        conversionActionId: ASSET_ACTION,
        adjustmentType: "RETRACTION",
      }),
    );
    expect(result.conversions).toEqual([
      { label: "call-asset value", status: "retracted" },
    ]);
  });

  test("a call without a conversion (no click, or a repeat call) only changes CallRail", async () => {
    const result = await markCallBadLead({
      callId: nextCallId(),
      trigger: "X reaction",
    });

    expect(markCallNotALeadMock).toHaveBeenCalled();
    expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
    expect(result.conversions).toEqual([]);
  });

  test("a conversion that never uploaded has nothing to retract", async () => {
    const callId = nextCallId();
    clickModel.findFirst.mockResolvedValue(
      clickRow(callId, { uploadedAt: null }),
    );

    const result = await markCallBadLead({ callId, trigger: "X reaction" });

    expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
    expect(result.conversions).toEqual([]);
  });

  test("a rejected retraction stays stored to retry", async () => {
    const callId = nextCallId();
    clickModel.findFirst.mockResolvedValue(clickRow(callId));
    uploadConversionAdjustmentMock.mockResolvedValue("CONVERSION_NOT_FOUND");

    const result = await markCallBadLead({ callId, trigger: "X reaction" });

    expect(clickModel.updateMany).toHaveBeenCalled();
    expect(clickModel.update).not.toHaveBeenCalled();
    expect(result.conversions).toEqual([
      { label: "call conversion", status: "pending" },
    ]);
  });

  test("validate-only mode checks the retraction but stores nothing", async () => {
    process.env.GOOGLE_ADS_RETRACTION_VALIDATE_ONLY = "TRUE";
    const callId = nextCallId();
    clickModel.findFirst.mockResolvedValue(clickRow(callId));
    uploadConversionAdjustmentMock.mockResolvedValue(true);

    const result = await markCallBadLead({ callId, trigger: "X reaction" });

    expect(uploadConversionAdjustmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ validateOnly: true }),
    );
    expect(clickModel.updateMany).not.toHaveBeenCalled();
    expect(clickModel.update).not.toHaveBeenCalled();
    expect(result.validateOnly).toBe(true);
    expect(result.conversions).toEqual([
      { label: "call conversion", status: "validated" },
    ]);
  });

  test("an already retracted conversion isn't sent again", async () => {
    const callId = nextCallId();
    clickModel.findFirst.mockResolvedValue(
      clickRow(callId, { retractedAt: new Date() }),
    );

    const result = await markCallBadLead({ callId, trigger: "X reaction" });

    expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
    expect(result.conversions).toEqual([
      { label: "call conversion", status: "already retracted" },
    ]);
  });

  test("a reaction and a deletion of the same post only act once", async () => {
    const callId = nextCallId();

    await markCallBadLead({ callId, trigger: "X reaction" });
    const second = await markCallBadLead({
      callId,
      trigger: "call post deleted",
    });

    expect(second.duplicate).toBe(true);
    expect(markCallNotALeadMock).toHaveBeenCalledTimes(1);
  });

  test("a CallRail failure is reported and can be retried", async () => {
    const callId = nextCallId();
    markCallNotALeadMock.mockRejectedValueOnce(new Error("CallRail 422"));

    const first = await markCallBadLead({ callId, trigger: "X reaction" });
    const second = await markCallBadLead({ callId, trigger: "X reaction" });

    expect(first.callRail).toBe("failed");
    expect(sentryMock.captureException).toHaveBeenCalled();
    expect(second.duplicate).toBe(false);
    expect(second.callRail).toBe("marked");
  });

  test("a database error is reported, not thrown", async () => {
    const callId = nextCallId();
    clickModel.findFirst.mockRejectedValue(new Error("db down"));

    const result = await markCallBadLead({ callId, trigger: "X reaction" });

    expect(result.conversions).toEqual([
      { label: "call conversion", status: "failed" },
    ]);
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});

describe("retryPendingRetractions", () => {
  test("resends stored retractions from the last week and records success", async () => {
    clickModel.findMany.mockResolvedValue([clickRow("CALpending")]);
    assetModel.findMany.mockResolvedValue([]);
    uploadConversionAdjustmentMock.mockResolvedValue(true);

    await retryPendingRetractions();

    expect(clickModel.findMany).toHaveBeenCalledWith({
      where: {
        retractedAt: null,
        retractRequestedAt: { not: null, gte: expect.any(Date) },
      },
    });
    expect(uploadConversionAdjustmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "CALpending",
        adjustmentType: "RETRACTION",
        validateOnly: false,
      }),
    );
    expect(clickModel.update).toHaveBeenCalledWith({
      where: { gclid: "Cj0-click" },
      data: { retractedAt: expect.any(Date) },
    });
  });
});
