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
  findFormLead,
  hashEmail,
  hashPhone,
  recordLeadFormLead,
  recordWebsiteFormLead,
  sendFormValue,
} = await import("../../util/apis/GoogleAdsLeadFormValues.js");

const LEAD_ACTION = "customers/6490233839/conversionActions/555000222";
const FORM_ACTION = "customers/6490233839/conversionActions/555000333";
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
  process.env.GOOGLE_ADS_FORM_CONVERSION_ACTION_ID = FORM_ACTION;
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
  delete process.env.GOOGLE_ADS_FORM_CONVERSION_ACTION_ID;
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

describe("findFormLead", () => {
  test("looks up the earliest lead in the click window by phone hash", async () => {
    const lead = storedLead();
    model.findFirst.mockResolvedValue(lead);

    await expect(findFormLead(client())).resolves.toBe(lead);

    const query = model.findFirst.mock.calls[0][0];
    expect(query.where.OR).toEqual([{ phoneHash: { in: [hashPhone(PHONE)] } }]);
    expect(query.where.createdAt.gte).toBeInstanceOf(Date);
    expect(query.orderBy).toEqual({ createdAt: "asc" });
    expect(query.where.source).toBeUndefined();
  });

  test("can be limited to a window", async () => {
    model.findFirst.mockResolvedValue(null);
    const from = new Date("2026-09-12T15:00:00Z");
    const until = new Date("2026-10-12T16:00:00Z");

    await findFormLead(client(), { from, until });

    const { where } = model.findFirst.mock.calls[0][0];
    expect(where.createdAt).toEqual({ gte: from, lte: until });
  });

  test("matches on email too", async () => {
    model.findFirst.mockResolvedValue(storedLead());

    await findFormLead(
      client({ phones: [], emails: [{ address: "LEAD@example.com" }] }),
    );

    const { where } = model.findFirst.mock.calls[0][0];
    expect(where.OR).toEqual([{ emailHash: { in: [hashEmail(EMAIL)] } }]);
  });

  test("without the lead form value action, Google Ads lead form leads are skipped", async () => {
    delete process.env.GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID;
    model.findFirst.mockResolvedValue(null);

    await expect(findFormLead(client())).resolves.toBeNull();

    const { where } = model.findFirst.mock.calls[0][0];
    expect(where.source).toEqual({ not: "google_lead_form" });
  });

  test("returns null for a client with no phone or email", async () => {
    await expect(findFormLead(client({ phones: [] }))).resolves.toBeNull();
    expect(model.findFirst).not.toHaveBeenCalled();
  });

  test("database errors are reported and return null", async () => {
    model.findFirst.mockRejectedValue(new Error("db down"));
    await expect(findFormLead(client())).resolves.toBeNull();
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});

describe("sendFormValue", () => {
  test("uploads the first value against the lead's click", async () => {
    await sendFormValue(storedLead(), 970);

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

  test("does nothing for a lead with no conversion action", async () => {
    delete process.env.GOOGLE_ADS_LEAD_FORM_VALUE_CONVERSION_ACTION_ID;
    await sendFormValue(storedLead(), 970);
    expect(model.updateMany).not.toHaveBeenCalled();
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
  });

  test("skips a lead whose upload is already in progress", async () => {
    model.updateMany.mockResolvedValue({ count: 0 });
    await sendFormValue(storedLead({ claimedAt: new Date() }), 970);
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
  });

  test("releases the claim when the upload fails, so a later event retries", async () => {
    uploadClickConversionMock.mockResolvedValue({
      success: false,
      requestId: null,
      validateOnly: false,
    });

    await sendFormValue(storedLead(), 970);

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

    await sendFormValue(storedLead(), 970);

    expect(model.update).toHaveBeenCalledWith({
      where: { leadId: LEAD_ID },
      data: { claimedAt: null },
    });
  });

  test("skips a value that was already sent", async () => {
    await sendFormValue(
      storedLead({ value: "970.00", uploadedAt: new Date() }),
      970,
    );

    expect(uploadClickConversionMock).not.toHaveBeenCalled();
    expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
  });

  test("restates a changed value by lead_id", async () => {
    await sendFormValue(
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
    await expect(sendFormValue(storedLead(), 970)).resolves.toBeUndefined();
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});

describe("website form leads", () => {
  const form = (overrides = {}) => ({
    name: "Test",
    phone: PHONE,
    email: EMAIL,
    message: "Clogged drain",
    gclid: GCLID,
    ...overrides,
  });

  beforeEach(() => {
    model.create.mockImplementation(async ({ data }) => storedLead(data));
  });

  test("records the click with hashed contact details and uploads a $0 Form Capture conversion", async () => {
    await recordWebsiteFormLead(form());

    const { data } = model.create.mock.calls[0][0];
    expect(data).toEqual({
      leadId: expect.stringMatching(/^web-[0-9a-f-]{36}$/),
      source: "website_form",
      conversionAction: FORM_ACTION,
      gclid: GCLID,
      gbraid: null,
      wbraid: null,
      phoneHash: hashPhone(PHONE),
      emailHash: hashEmail(EMAIL),
      conversionDateTime: EVENT_TS,
    });
    expect(JSON.stringify(data)).not.toContain("5550100");
    expect(JSON.stringify(data).toLowerCase()).not.toContain("example.com");
    expect(uploadClickConversionMock).toHaveBeenCalledWith({
      gclid: GCLID,
      gbraid: undefined,
      wbraid: undefined,
      conversionDateTime: EVENT_TS,
      transactionId: data.leadId,
      conversionValue: 0,
      conversionActionId: FORM_ACTION,
      eventSource: "WEB",
    });
    expect(model.update).toHaveBeenCalledWith({
      where: { leadId: data.leadId },
      data: expect.objectContaining({ value: 0, requestId: "req-1" }),
    });
  });

  test("an iOS click with only a gbraid is recorded and uploaded", async () => {
    await recordWebsiteFormLead(
      form({ gclid: undefined, gbraid: "0AAAAAgbraid" }),
    );

    expect(model.create.mock.calls[0][0].data).toMatchObject({
      gclid: null,
      gbraid: "0AAAAAgbraid",
    });
    expect(uploadClickConversionMock).toHaveBeenCalledWith(
      expect.objectContaining({ gbraid: "0AAAAAgbraid", gclid: undefined }),
    );
  });

  test("an organic form (no click ID) is recorded but never uploaded", async () => {
    await recordWebsiteFormLead(form({ gclid: undefined }));

    expect(model.create.mock.calls[0][0].data).toMatchObject({
      source: "website_form",
      conversionAction: null,
      gclid: null,
      gbraid: null,
      wbraid: null,
      phoneHash: hashPhone(PHONE),
      emailHash: hashEmail(EMAIL),
    });
    expect(model.updateMany).not.toHaveBeenCalled();
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
  });

  test("an organic form with no phone or email isn't recorded", async () => {
    await recordWebsiteFormLead(
      form({ gclid: undefined, phone: "", email: undefined }),
    );
    expect(model.create).not.toHaveBeenCalled();
  });

  test("malformed click IDs are dropped, leaving an organic form", async () => {
    await recordWebsiteFormLead(form({ gclid: "<script>alert(1)</script>" }));
    await recordWebsiteFormLead(form({ gclid: { $ne: null } }));

    for (const [{ data }] of model.create.mock.calls) {
      expect(data.gclid).toBeNull();
      expect(data.conversionAction).toBeNull();
    }
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
  });

  test("an organic form as first contact sends nothing to Google Ads", async () => {
    const organic = storedLead({
      leadId: "web-organic",
      source: "website_form",
      conversionAction: null,
      gclid: null,
    });

    await sendFormValue(organic, 970);

    expect(model.updateMany).not.toHaveBeenCalled();
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
    expect(uploadConversionAdjustmentMock).not.toHaveBeenCalled();
  });

  test("does nothing without the Form Capture env var", async () => {
    delete process.env.GOOGLE_ADS_FORM_CONVERSION_ACTION_ID;
    await recordWebsiteFormLead(form());
    expect(model.create).not.toHaveBeenCalled();
  });

  test("database errors are reported, not thrown", async () => {
    model.create.mockRejectedValue(new Error("db down"));
    await expect(recordWebsiteFormLead(form())).resolves.toBeUndefined();
    expect(sentryMock.captureException).toHaveBeenCalled();
    expect(uploadClickConversionMock).not.toHaveBeenCalled();
  });

  test("the invoice value restates the website form's own $0 conversion", async () => {
    const lead = storedLead({
      leadId: "web-1",
      source: "website_form",
      conversionAction: FORM_ACTION,
      value: "0.00",
      uploadedAt: new Date(),
    });

    await sendFormValue(lead, 970);

    expect(uploadClickConversionMock).not.toHaveBeenCalled();
    expect(uploadConversionAdjustmentMock).toHaveBeenCalledWith({
      gclid: GCLID,
      conversionDateTime: EVENT_TS,
      adjustedValue: 970,
      orderId: "web-1",
      conversionActionId: FORM_ACTION,
    });
  });

  test("a website form whose $0 upload failed gets its value as a new upload", async () => {
    const lead = storedLead({
      leadId: "web-2",
      source: "website_form",
      conversionAction: FORM_ACTION,
    });

    await sendFormValue(lead, 450);

    expect(uploadClickConversionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: "web-2",
        conversionValue: 450,
        conversionActionId: FORM_ACTION,
        eventSource: "WEB",
      }),
    );
  });

  test("an uploaded lead with no stored value is restated, never treated as already sent", async () => {
    await sendFormValue(
      storedLead({ value: null, uploadedAt: new Date() }),
      970,
    );
    expect(uploadConversionAdjustmentMock).toHaveBeenCalled();
  });
});
