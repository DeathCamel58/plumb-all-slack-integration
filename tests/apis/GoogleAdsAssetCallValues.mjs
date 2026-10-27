import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const sentryMock = { captureException: jest.fn() };
const uploadClickConversionMock = jest.fn();
const uploadConversionAdjustmentMock = jest.fn();
const model = {
  create: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn(),
  deleteMany: jest.fn(),
};

const START_TIME = "2026-09-23T13:42:24.157-04:00";
const EVENT_TS = "2026-09-23T13:42:24-04:00";

jest.unstable_mockModule("@sentry/node", () => sentryMock);
jest.unstable_mockModule("../../util/prismaClient.js", () => ({
  default: { googleAdsAssetCallValue: model },
}));
jest.unstable_mockModule("../../util/apis/GoogleAdsClickTracking.js", () => ({
  STALE_CLAIM_MS: 10 * 60 * 1000,
}));
jest.unstable_mockModule("../../util/apis/GoogleAdsConversions.js", () => ({
  toEventTimestamp: (startTime) =>
    startTime === START_TIME ? EVENT_TS : `ts(${startTime})`,
  uploadClickConversion: uploadClickConversionMock,
  uploadConversionAdjustment: uploadConversionAdjustmentMock,
}));

const { sendAssetCallValue } =
  await import("../../util/apis/GoogleAdsAssetCallValues.js");

const ASSET_ACTION = "customers/6490233839/conversionActions/555000111";
const GCLID = "CjwKCAjwAssetGCLID";
const CALL_ID = "CALasset0000000000000000000000001";

/** P2002 as thrown under adapter-pg. */
function uniqueViolation() {
  const e = new Error("Unique constraint failed");
  e.code = "P2002";
  e.meta = {
    modelName: "GoogleAdsAssetCallValue",
    driverAdapterError: {
      cause: {
        kind: "UniqueConstraintViolation",
        constraint: { fields: ['"callId"'] },
      },
    },
  };
  return e;
}

function storedRow(overrides = {}) {
  return {
    callId: CALL_ID,
    gclid: GCLID,
    conversionDateTime: EVENT_TS,
    value: "970.00", // Prisma Decimal stringifies like this
    uploadedAt: new Date("2026-09-24T12:00:00Z"),
    requestId: "req-1",
    restatedAt: null,
    createdAt: new Date("2026-09-24T11:59:58Z"),
    ...overrides,
  };
}

const send = (value, overrides = {}) =>
  sendAssetCallValue({
    gclid: GCLID,
    callId: CALL_ID,
    startTime: START_TIME,
    value,
    ...overrides,
  });

describe("GoogleAdsAssetCallValues", () => {
  let logSpy, warnSpy, errorSpy;

  beforeEach(() => {
    for (const fn of Object.values(model)) fn.mockReset();
    uploadClickConversionMock.mockReset();
    uploadClickConversionMock.mockResolvedValue({
      success: true,
      requestId: "req-1",
      validateOnly: false,
    });
    uploadConversionAdjustmentMock.mockReset();
    uploadConversionAdjustmentMock.mockResolvedValue(true);
    sentryMock.captureException.mockReset();
    process.env.GOOGLE_ADS_ASSET_VALUE_CONVERSION_ACTION_ID = ASSET_ACTION;
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("First value → claims the row, uploads with the value and asset action, marks it uploaded", async () => {
    model.findUnique.mockResolvedValue(null);
    model.create.mockResolvedValue({});

    await send(970);

    expect(model.create).toHaveBeenCalledWith({
      data: {
        callId: CALL_ID,
        gclid: GCLID,
        conversionDateTime: EVENT_TS,
        value: 970,
        uploadedAt: null,
      },
    });
    expect(uploadClickConversionMock).toHaveBeenCalledWith({
      gclid: GCLID,
      conversionDateTime: START_TIME,
      transactionId: CALL_ID,
      conversionValue: 970,
      conversionActionId: ASSET_ACTION,
    });
    expect(model.update).toHaveBeenCalledWith({
      where: { callId: CALL_ID },
      data: { uploadedAt: expect.any(Date), requestId: "req-1" },
    });
    expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
  });

  test("Same value again → no API call", async () => {
    model.findUnique.mockResolvedValue(storedRow());

    await send(970);

    expect(uploadClickConversionMock).not.toHaveBeenCalled();
    expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
  });

  test("Changed value → restatement against the stored conversionDateTime", async () => {
    model.findUnique.mockResolvedValue(
      storedRow({ conversionDateTime: "2026-09-20T08:00:00-04:00" }),
    );

    await send(1250);

    expect(uploadConversionAdjustmentMock).toHaveBeenCalledWith({
      gclid: GCLID,
      conversionDateTime: "2026-09-20T08:00:00-04:00",
      adjustedValue: 1250,
      orderId: CALL_ID,
      conversionActionId: ASSET_ACTION,
    });
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
    expect(model.update).toHaveBeenCalledWith({
      where: { callId: CALL_ID },
      data: { value: 1250, restatedAt: expect.any(Date) },
    });
  });

  test("Changed to $0 → restated to 0", async () => {
    model.findUnique.mockResolvedValue(storedRow());

    await send(0);

    expect(uploadConversionAdjustmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ adjustedValue: 0 }),
    );
  });

  test("Restatement fails → stored value left unchanged", async () => {
    model.findUnique.mockResolvedValue(storedRow());
    uploadConversionAdjustmentMock.mockResolvedValue(false);

    await send(1250);

    expect(model.update).not.toHaveBeenCalled();
  });

  test.each([
    [{ success: false, requestId: null, validateOnly: false }, "fails"],
    [{ success: true, requestId: "req-1", validateOnly: true }, "is a dry run"],
  ])(
    "Upload %o (%s) → claim deleted so the next webhook retries",
    async (result) => {
      model.findUnique.mockResolvedValue(null);
      model.create.mockResolvedValue({});
      uploadClickConversionMock.mockResolvedValue(result);

      await send(970);

      expect(model.deleteMany).toHaveBeenCalledWith({
        where: { callId: CALL_ID, uploadedAt: null },
      });
      expect(model.update).not.toHaveBeenCalled();
    },
  );

  test("P2002 on claim → no upload", async () => {
    model.findUnique.mockResolvedValue(null);
    model.create.mockRejectedValue(uniqueViolation());

    await send(970);

    expect(uploadClickConversionMock).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  test("Env unset → no DB or API calls", async () => {
    delete process.env.GOOGLE_ADS_ASSET_VALUE_CONVERSION_ACTION_ID;

    await send(970);

    for (const fn of Object.values(model)) expect(fn).not.toHaveBeenCalled();
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
    expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
  });

  test("No call id → no DB or API calls", async () => {
    await send(970, { callId: undefined });

    expect(model.findUnique).not.toHaveBeenCalled();
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
  });

  test("Fresh un-uploaded claim → skipped as in progress", async () => {
    model.findUnique.mockResolvedValue(
      storedRow({ uploadedAt: null, createdAt: new Date() }),
    );

    await send(970);

    expect(model.deleteMany).not.toHaveBeenCalled();
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
  });

  test("Stale un-uploaded claim → conditionally deleted, then re-claimed and uploaded", async () => {
    model.findUnique.mockResolvedValue(
      storedRow({
        uploadedAt: null,
        createdAt: new Date(Date.now() - 11 * 60 * 1000),
      }),
    );
    model.deleteMany.mockResolvedValue({ count: 1 });
    model.create.mockResolvedValue({});

    await send(970);

    expect(model.deleteMany).toHaveBeenCalledWith({
      where: {
        callId: CALL_ID,
        uploadedAt: null,
        createdAt: { lt: expect.any(Date) },
      },
    });
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(uploadClickConversionMock).toHaveBeenCalledTimes(1);
  });

  test("DB error → Sentry captures, never throws", async () => {
    model.findUnique.mockRejectedValue(new Error("connection reset"));

    await expect(send(970)).resolves.toBeUndefined();
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
  });
});
