import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const fetchMock = jest.fn();
const sentryMock = {
  captureException: jest.fn(),
  captureMessage: jest.fn(),
};
const model = {
  create: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn(),
  deleteMany: jest.fn(),
};

jest.unstable_mockModule("node-fetch", () => ({ default: fetchMock }));
jest.unstable_mockModule("@sentry/node", () => sentryMock);
jest.unstable_mockModule("../../util/prismaClient.js", () => ({
  default: { googleAdsClickConversion: model },
}));

const {
  claimClickConversion,
  markClickConversionUploaded,
  releaseClickConversion,
  resolveConversionForGclid,
  restateClickConversion,
} = await import("../../util/apis/GoogleAdsClickTracking.js");

const GCLID = "Cj0KCQjw-click";
const FIRST_CALL_START = "2026-09-23T13:42:24.157-04:00";
const FIRST_CALL_EVENT_TS = "2026-09-23T13:42:24-04:00";
const THIRD_CALL_START = "2026-09-25T09:10:11.500-04:00";

/** P2002 as thrown under adapter-pg: fields live on driverAdapterError, not meta.target. */
function adapterUniqueViolation() {
  const e = new Error("Unique constraint failed");
  e.code = "P2002";
  e.meta = {
    modelName: "GoogleAdsClickConversion",
    driverAdapterError: {
      cause: {
        kind: "UniqueConstraintViolation",
        constraint: { fields: ['"gclid"'] },
      },
    },
  };
  return e;
}

/** P2021 as thrown under adapter-pg when the table doesn't exist (42P01). */
function missingTable() {
  const e = new Error(
    "The table `GoogleAdsClickConversion` does not exist in the current database.",
  );
  e.code = "P2021";
  e.meta = {
    modelName: "GoogleAdsClickConversion",
    driverAdapterError: {
      cause: {
        kind: "TableDoesNotExist",
        table: "GoogleAdsClickConversion",
        originalCode: "42P01",
      },
    },
  };
  return e;
}

function uploadedRow(overrides = {}) {
  return {
    gclid: GCLID,
    transactionId: "CALfirst",
    conversionDateTime: FIRST_CALL_EVENT_TS,
    callStartTime: new Date(FIRST_CALL_START),
    uploadedAt: new Date("2026-09-23T17:43:00Z"),
    requestId: "req-1",
    restatedValue: null,
    restatedCalls: null,
    restatedAt: null,
    ...overrides,
  };
}

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => "" };
}

/** Queues an OAuth token response, then a successful adjustment response. */
function mockAdjustmentApi(apiResponse = jsonResponse({ results: [{}] })) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ access_token: "token-1" }))
    .mockResolvedValueOnce(apiResponse);
}

function adjustmentSent() {
  const [, options] = fetchMock.mock.calls[1];
  return JSON.parse(options.body).conversionAdjustments[0];
}

describe("GoogleAdsClickTracking", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    sentryMock.captureException.mockReset();
    sentryMock.captureMessage.mockReset();
    for (const fn of Object.values(model)) fn.mockReset();
    process.env.GOOGLE_ADS_CUSTOMER_ID = "1112223333";
    process.env.GOOGLE_ADS_CONVERSION_ACTION_ID =
      "customers/1112223333/conversionActions/987654321";
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
  });

  describe("claimClickConversion", () => {
    test("Creates the row with the exact eventTimestamp sent to Google", async () => {
      model.create.mockResolvedValue({});

      const claim = await claimClickConversion({
        gclid: GCLID,
        transactionId: "CALfirst",
        startTime: FIRST_CALL_START,
      });

      expect(claim).toEqual({
        status: "claimed",
        conversionDateTime: FIRST_CALL_EVENT_TS,
      });
      expect(model.create).toHaveBeenCalledWith({
        data: {
          gclid: GCLID,
          transactionId: "CALfirst",
          conversionDateTime: FIRST_CALL_EVENT_TS,
          callStartTime: new Date(FIRST_CALL_START),
          uploadedAt: null,
        },
      });
    });

    test("Concurrent duplicate (adapter-pg P2002 shape) → duplicate, not an error", async () => {
      model.create.mockRejectedValue(adapterUniqueViolation());
      model.findUnique.mockResolvedValue(uploadedRow());

      const claim = await claimClickConversion({
        gclid: GCLID,
        transactionId: "CALsecond",
        startTime: THIRD_CALL_START,
      });

      expect(claim.status).toBe("duplicate");
      expect(claim.existing.transactionId).toBe("CALfirst");
      expect(sentryMock.captureException).not.toHaveBeenCalled();
    });

    test("Missing table → unavailable (caller uploads anyway), Sentry captured", async () => {
      const errorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      model.create.mockRejectedValue(missingTable());

      const claim = await claimClickConversion({
        gclid: GCLID,
        transactionId: "CALfirst",
        startTime: FIRST_CALL_START,
      });

      expect(claim).toEqual({ status: "unavailable" });
      expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
      expect(
        errorSpy.mock.calls.some(([msg]) =>
          String(msg).includes("table does not exist"),
        ),
      ).toBe(true);
      errorSpy.mockRestore();
    });

    test("Other DB error → unavailable, never throws", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      model.create.mockRejectedValue(new Error("connection reset"));

      await expect(
        claimClickConversion({
          gclid: GCLID,
          transactionId: "CALfirst",
          startTime: FIRST_CALL_START,
        }),
      ).resolves.toEqual({ status: "unavailable" });
      console.error.mockRestore();
    });
  });

  describe("markClickConversionUploaded / releaseClickConversion", () => {
    test("Mark uploaded → sets uploadedAt and requestId", async () => {
      model.update.mockResolvedValue({});

      await markClickConversionUploaded(GCLID, "req-9");

      expect(model.update).toHaveBeenCalledWith({
        where: { gclid: GCLID },
        data: { uploadedAt: expect.any(Date), requestId: "req-9" },
      });
    });

    test("Release → deletes only this call's un-uploaded claim", async () => {
      model.deleteMany.mockResolvedValue({ count: 1 });

      await releaseClickConversion(GCLID, "CALfirst");

      expect(model.deleteMany).toHaveBeenCalledWith({
        where: { gclid: GCLID, transactionId: "CALfirst", uploadedAt: null },
      });
    });

    test("Released claim → a later call on the same GCLID can claim it", async () => {
      model.create.mockRejectedValueOnce(adapterUniqueViolation());
      model.findUnique.mockResolvedValueOnce(uploadedRow({ uploadedAt: null }));
      const blocked = await claimClickConversion({
        gclid: GCLID,
        transactionId: "CALsecond",
        startTime: THIRD_CALL_START,
      });
      expect(blocked.status).toBe("duplicate");

      model.deleteMany.mockResolvedValue({ count: 1 });
      await releaseClickConversion(GCLID, "CALfirst");

      model.create.mockResolvedValueOnce({});
      const retry = await claimClickConversion({
        gclid: GCLID,
        transactionId: "CALthird",
        startTime: THIRD_CALL_START,
      });
      expect(retry.status).toBe("claimed");
    });

    test("Store errors on mark/release never throw", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      model.update.mockRejectedValue(missingTable());
      model.deleteMany.mockRejectedValue(missingTable());

      await expect(
        markClickConversionUploaded(GCLID, "req-1"),
      ).resolves.toBeUndefined();
      await expect(
        releaseClickConversion(GCLID, "CALfirst"),
      ).resolves.toBeUndefined();
      console.error.mockRestore();
    });
  });

  describe("resolveConversionForGclid", () => {
    test("Uploaded row → stored first-call conversionDateTime", async () => {
      model.findUnique.mockResolvedValue(uploadedRow());

      const resolved = await resolveConversionForGclid(GCLID, THIRD_CALL_START);

      expect(resolved.conversionDateTime).toBe(FIRST_CALL_EVENT_TS);
      expect(resolved.row).not.toBeNull();
    });

    test("Row not uploaded yet → falls back to the call's own start_time", async () => {
      model.findUnique.mockResolvedValue(uploadedRow({ uploadedAt: null }));

      const resolved = await resolveConversionForGclid(GCLID, THIRD_CALL_START);

      expect(resolved).toEqual({
        conversionDateTime: THIRD_CALL_START,
        row: null,
      });
    });

    test("No row → falls back to the call's own start_time", async () => {
      model.findUnique.mockResolvedValue(null);

      const resolved = await resolveConversionForGclid(GCLID, THIRD_CALL_START);

      expect(resolved.conversionDateTime).toBe(THIRD_CALL_START);
    });

    test("Missing table → falls back to the call's own start_time", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      model.findUnique.mockRejectedValue(missingTable());

      const resolved = await resolveConversionForGclid(GCLID, THIRD_CALL_START);

      expect(resolved.conversionDateTime).toBe(THIRD_CALL_START);
      console.error.mockRestore();
    });
  });

  describe("restateClickConversion", () => {
    test("Value on call #3 → restates the first call's conversion", async () => {
      model.findUnique.mockResolvedValue(uploadedRow());
      model.update.mockResolvedValue({});
      mockAdjustmentApi();

      const result = await restateClickConversion({
        gclid: GCLID,
        startTime: THIRD_CALL_START,
        value: 745,
        callId: "CALthird",
      });

      expect(result).toBe(true);
      const adjustment = adjustmentSent();
      expect(adjustment.gclidDateTimePair).toEqual({
        gclid: GCLID,
        conversionDateTime: "2026-09-23 13:42:24-04:00",
      });
      expect(adjustment.restatementValue.adjustedValue).toBe(745);
      expect(model.update).toHaveBeenCalledWith({
        where: { gclid: GCLID },
        data: {
          restatedValue: 745,
          restatedCalls: { "2026-09-25T09:10:11-04:00": 745 },
          restatedAt: expect.any(Date),
        },
      });
    });

    test("No row → restates against the call's own start_time", async () => {
      model.findUnique.mockResolvedValue(null);
      mockAdjustmentApi();

      await restateClickConversion({
        gclid: GCLID,
        startTime: THIRD_CALL_START,
        value: 300,
      });

      expect(adjustmentSent().gclidDateTimePair.conversionDateTime).toBe(
        "2026-09-25 09:10:11-04:00",
      );
      expect(adjustmentSent().restatementValue.adjustedValue).toBe(300);
      expect(model.update).not.toHaveBeenCalled();
    });

    test("Second value from another call on the same GCLID → restates to the sum, warns", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      model.findUnique.mockResolvedValue(
        uploadedRow({
          restatedValue: "745.00",
          restatedCalls: { "2026-09-25T09:10:11-04:00": 745 },
        }),
      );
      model.update.mockResolvedValue({});
      mockAdjustmentApi();

      await restateClickConversion({
        gclid: GCLID,
        startTime: "2026-09-27T15:00:00.000-04:00",
        value: 255.5,
        callId: "CALfourth",
      });

      expect(adjustmentSent().restatementValue.adjustedValue).toBe(1000.5);
      expect(adjustmentSent().gclidDateTimePair.conversionDateTime).toBe(
        "2026-09-23 13:42:24-04:00",
      );
      expect(model.update.mock.calls[0][0].data.restatedValue).toBe(1000.5);
      expect(
        warnSpy.mock.calls.some(
          ([msg]) =>
            String(msg).includes("$745") &&
            String(msg).includes("$255.5") &&
            String(msg).includes("$1000.5"),
        ),
      ).toBe(true);
      warnSpy.mockRestore();
    });

    test("Same call fired again → doesn't double-count", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      model.findUnique.mockResolvedValue(
        uploadedRow({
          restatedValue: "745.00",
          restatedCalls: { "2026-09-25T09:10:11-04:00": 745 },
        }),
      );
      model.update.mockResolvedValue({});
      mockAdjustmentApi();

      await restateClickConversion({
        gclid: GCLID,
        startTime: THIRD_CALL_START,
        value: 745,
        callId: "CALthird",
      });

      expect(adjustmentSent().restatementValue.adjustedValue).toBe(745);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test("Adjustment fails → restatement not recorded", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      model.findUnique.mockResolvedValue(uploadedRow());
      mockAdjustmentApi(
        jsonResponse({ error: { message: "bad" } }, false, 400),
      );

      const result = await restateClickConversion({
        gclid: GCLID,
        startTime: THIRD_CALL_START,
        value: 745,
      });

      expect(result).toBe(false);
      expect(model.update).not.toHaveBeenCalled();
      console.error.mockRestore();
    });

    test("Missing table → still restates against the call's own start_time", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      model.findUnique.mockRejectedValue(missingTable());
      mockAdjustmentApi();

      const result = await restateClickConversion({
        gclid: GCLID,
        startTime: THIRD_CALL_START,
        value: 745,
      });

      expect(result).toBe(true);
      expect(adjustmentSent().gclidDateTimePair.conversionDateTime).toBe(
        "2026-09-25 09:10:11-04:00",
      );
      console.error.mockRestore();
    });
  });
});
