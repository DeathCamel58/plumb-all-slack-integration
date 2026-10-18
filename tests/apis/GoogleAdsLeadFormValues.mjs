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
  findFirst: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};

const EVENT_TS = "2026-10-18T14:05:09-04:00";

jest.unstable_mockModule("@sentry/node", () => sentryMock);
jest.unstable_mockModule("../../util/prismaClient.js", () => ({
  default: { googleAdsLeadFormLead: model },
}));
jest.unstable_mockModule("../../util/apis/GoogleAdsClickTracking.js", () => ({
  STALE_CLAIM_MS: 10 * 60 * 1000,
}));
jest.unstable_mockModule("../../util/apis/GoogleAdsConversions.js", () => ({
  toEventTimestamp: () => EVENT_TS,
  uploadClickConversion: uploadClickConversionMock,
  uploadConversionAdjustment: uploadConversionAdjustmentMock,
}));

const {
  findLeadFormLead,
  hashEmail,
  hashPhone,
  recordLeadFormLead,
  sendLeadFormValue,
} = await import("../../util/apis/GoogleAdsLeadFormValues.js");

const LEAD_ACTION = "customers/6490233839/conversionActions/555000222";
const GCLID = "CjwKCAjwLeadFormGCLID";
const LEAD_ID = "TeSter-123-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PHONE = "(770) 555-0100";
const EMAIL = " Lead@Example.com ";

/** P2002 as thrown under adapter-pg. */
function uniqueViolation() {
  const e = new Error("Unique constraint failed");
  e.code = "P2002";
  e.meta = {
    modelName: "GoogleAdsLeadFormLead",
    driverAdapterError: {
      cause: {
        kind: "UniqueConstraintViolation",
        constraint: { fields: ['"leadId"'] },
      },
    },
  };
  return e;
}

function storedLead(overrides = {}) {
  return {
    leadId: LEAD_ID,
    gclid: GCLID,
    phoneHash: hashPhone(PHONE),
    emailHash: hashEmail(EMAIL),
    conversionDateTime: EVENT_TS,
    value: null,
    claimedAt: null,
    uploadedAt: null,
    requestId: null,
    restatedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

const client = (overrides = {}) => ({
  id: "client-1",
  phones: [{ number: "770-555-0100", primary: true }],
  emails: [],
  ...overrides,
});

beforeEach(() => {
  process.env.GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID = LEAD_ACTION;
  model.updateMany.mockResolvedValue({ count: 1 });
  model.update.mockResolvedValue({});
  uploadClickConversionMock.mockResolvedValue({
    success: true,
    requestId: "req-1",
    validateOnly: false,
  });
  uploadConversionAdjustmentMock.mockResolvedValue(true);
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.resetAllMocks();
  jest.restoreAllMocks();
  delete process.env.GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID;
});

describe("hashing", () => {
  test("phones hash the same whatever their formatting", () => {
    expect(hashPhone("(770) 555-0100")).toBe(hashPhone("+17705550100"));
    expect(hashPhone("(770) 555-0100")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("emails hash case- and whitespace-insensitively", () => {
    expect(hashEmail(" Lead@Example.com ")).toBe(hashEmail("lead@example.com"));
  });

  test("missing values hash to null", () => {
    expect(hashPhone(undefined)).toBeNull();
    expect(hashEmail("")).toBeNull();
  });
});

describe("recordLeadFormLead", () => {
  const body = (overrides = {}) => ({
    lead_id: LEAD_ID,
    gcl_id: GCLID,
    is_test: false,
    ...overrides,
  });

  test("stores the GCLID with hashed contact details, never the raw ones", async () => {
    await recordLeadFormLead(body(), { PHONE_NUMBER: PHONE, EMAIL });

    const { data } = model.create.mock.calls[0][0];
    expect(data).toEqual({
      leadId: LEAD_ID,
      gclid: GCLID,
      phoneHash: hashPhone(PHONE),
      emailHash: hashEmail(EMAIL),
      conversionDateTime: EVENT_TS,
    });
    expect(JSON.stringify(data)).not.toContain("555");
    expect(JSON.stringify(data).toLowerCase()).not.toContain("example.com");
  });

  test("skips test submissions", async () => {
    await recordLeadFormLead(body({ is_test: true }), { PHONE_NUMBER: PHONE });
    expect(model.create).not.toHaveBeenCalled();
  });

  test("skips submissions without a GCLID", async () => {
    await recordLeadFormLead(body({ gcl_id: undefined }), {
      PHONE_NUMBER: PHONE,
    });
    expect(model.create).not.toHaveBeenCalled();
  });

  test("a redelivered webhook keeps the first row", async () => {
    model.create.mockRejectedValue(uniqueViolation());
    await recordLeadFormLead(body(), { PHONE_NUMBER: PHONE });
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  test("other database errors are reported, not thrown", async () => {
    model.create.mockRejectedValue(new Error("db down"));
    await expect(
      recordLeadFormLead(body(), { PHONE_NUMBER: PHONE }),
    ).resolves.toBeUndefined();
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});

describe("findLeadFormLead", () => {
  test("looks up the most recent lead in the click window by phone hash", async () => {
    const lead = storedLead();
    model.findFirst.mockResolvedValue(lead);

    await expect(findLeadFormLead(client())).resolves.toBe(lead);

    const query = model.findFirst.mock.calls[0][0];
    expect(query.where.OR).toEqual([{ phoneHash: { in: [hashPhone(PHONE)] } }]);
    expect(query.where.createdAt.gte).toBeInstanceOf(Date);
    expect(query.orderBy).toEqual({ createdAt: "desc" });
  });

  test("matches on email too", async () => {
    model.findFirst.mockResolvedValue(storedLead());

    await findLeadFormLead(
      client({ phones: [], emails: [{ address: "LEAD@example.com" }] }),
    );

    const { where } = model.findFirst.mock.calls[0][0];
    expect(where.OR).toEqual([{ emailHash: { in: [hashEmail(EMAIL)] } }]);
  });

  test("returns null without the conversion action env var, so another source gets credit", async () => {
    delete process.env.GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID;
    await expect(findLeadFormLead(client())).resolves.toBeNull();
    expect(model.findFirst).not.toHaveBeenCalled();
  });

  test("returns null for a client with no phone or email", async () => {
    await expect(findLeadFormLead(client({ phones: [] }))).resolves.toBeNull();
    expect(model.findFirst).not.toHaveBeenCalled();
  });

  test("database errors are reported and return null", async () => {
    model.findFirst.mockRejectedValue(new Error("db down"));
    await expect(findLeadFormLead(client())).resolves.toBeNull();
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});

describe("sendLeadFormValue", () => {
  test("uploads the first value against the lead's click", async () => {
    await sendLeadFormValue(storedLead(), 970);

    expect(uploadClickConversionMock).toHaveBeenCalledWith({
      gclid: GCLID,
      conversionDateTime: EVENT_TS,
      transactionId: LEAD_ID,
      conversionValue: 970,
      conversionActionId: LEAD_ACTION,
    });
    expect(model.update).toHaveBeenCalledWith({
      where: { leadId: LEAD_ID },
      data: expect.objectContaining({
        value: 970,
        requestId: "req-1",
        claimedAt: null,
      }),
    });
  });

  test("does nothing without the conversion action env var", async () => {
    delete process.env.GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID;
    await sendLeadFormValue(storedLead(), 970);
    expect(model.updateMany).not.toHaveBeenCalled();
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
  });

  test("skips a lead whose upload is already in progress", async () => {
    model.updateMany.mockResolvedValue({ count: 0 });
    await sendLeadFormValue(storedLead({ claimedAt: new Date() }), 970);
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
  });

  test("releases the claim when the upload fails, so a later event retries", async () => {
    uploadClickConversionMock.mockResolvedValue({
      success: false,
      requestId: null,
      validateOnly: false,
    });

    await sendLeadFormValue(storedLead(), 970);

    expect(model.update).toHaveBeenCalledWith({
      where: { leadId: LEAD_ID },
      data: { claimedAt: null },
    });
  });

  test("a dry run doesn't mark the lead uploaded", async () => {
    uploadClickConversionMock.mockResolvedValue({
      success: true,
      requestId: null,
      validateOnly: true,
    });

    await sendLeadFormValue(storedLead(), 970);

    expect(model.update).toHaveBeenCalledWith({
      where: { leadId: LEAD_ID },
      data: { claimedAt: null },
    });
  });

  test("skips a value that was already sent", async () => {
    await sendLeadFormValue(
      storedLead({ value: "970.00", uploadedAt: new Date() }),
      970,
    );

    expect(uploadClickConversionMock).not.toHaveBeenCalled();
    expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
  });

  test("restates a changed value by lead_id", async () => {
    await sendLeadFormValue(
      storedLead({ value: "970.00", uploadedAt: new Date() }),
      1200,
    );

    expect(uploadConversionAdjustmentMock).toHaveBeenCalledWith({
      gclid: GCLID,
      conversionDateTime: EVENT_TS,
      adjustedValue: 1200,
      orderId: LEAD_ID,
      conversionActionId: LEAD_ACTION,
    });
    expect(model.update).toHaveBeenCalledWith({
      where: { leadId: LEAD_ID },
      data: expect.objectContaining({ value: 1200 }),
    });
  });

  test("errors are reported, not thrown", async () => {
    model.updateMany.mockRejectedValue(new Error("db down"));
    await expect(sendLeadFormValue(storedLead(), 970)).resolves.toBeUndefined();
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});
