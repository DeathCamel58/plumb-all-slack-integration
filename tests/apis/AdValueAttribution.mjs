import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsOnMock = jest.fn();
const sentryMock = { captureException: jest.fn() };
const individualSearchMock = jest.fn();
const searchCallByPhoneMock = jest.fn();
const searchSMSByPhoneMock = jest.fn();
const updateCallMock = jest.fn();
const updateSMSThreadMock = jest.fn();
const findFormLeadMock = jest.fn();
const sendFormValueMock = jest.fn();

/** In-memory AdValueAttribution table, so totals are summed for real */
let rows = [];
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, cond]) =>
    cond && typeof cond === "object" && "in" in cond
      ? cond.in.includes(row[key])
      : row[key] === cond,
  );
const attribution = {
  findUnique: jest.fn(
    async ({ where }) => rows.find((r) => r.itemId === where.itemId) ?? null,
  ),
  findMany: jest.fn(async ({ where }) => rows.filter((r) => matches(r, where))),
  count: jest.fn(
    async ({ where }) => rows.filter((r) => matches(r, where)).length,
  ),
  create: jest.fn(async ({ data }) => {
    if (rows.some((r) => r.itemId === data.itemId)) {
      const e = new Error("Unique constraint failed");
      e.code = "P2002";
      e.meta = { target: ["itemId"] };
      throw e;
    }
    rows.push({ ...data });
    return data;
  }),
  upsert: jest.fn(async ({ where, create }) => {
    if (!rows.some((r) => r.itemId === where.itemId)) rows.push({ ...create });
  }),
  deleteMany: jest.fn(async ({ where }) => {
    rows = rows.filter((r) => !matches(r, where));
  }),
};

const prismaMock = {
  adValueAttribution: attribution,
  client: { findMany: jest.fn() },
  job: { findMany: jest.fn() },
  quote: { findMany: jest.fn(), findUnique: jest.fn() },
  invoice: { findMany: jest.fn(), findUnique: jest.fn() },
  payment: { findMany: jest.fn() },
  jobsOnInvoices: { findMany: jest.fn() },
  googleAdsLeadFormLead: { findUnique: jest.fn() },
};

jest.unstable_mockModule("../../util/events.js", () => ({
  default: { emit: jest.fn(), on: eventsOnMock },
}));
jest.unstable_mockModule("@sentry/node", () => sentryMock);
jest.unstable_mockModule("../../util/prismaClient.js", () => ({
  default: prismaMock,
}));
jest.unstable_mockModule("../../util/apis/PostHog.js", () => ({
  individualSearch: individualSearchMock,
}));
jest.unstable_mockModule("../../util/apis/CallRail.js", () => ({
  searchCallByPhone: searchCallByPhoneMock,
  searchSMSByPhone: searchSMSByPhoneMock,
  updateCall: updateCallMock,
  updateSMSThread: updateSMSThreadMock,
}));
jest.unstable_mockModule("../../util/apis/GoogleAdsLeadFormValues.js", () => ({
  findFormLead: findFormLeadMock,
  sendFormValue: sendFormValueMock,
}));

const {
  creditDeposit,
  creditInvoice,
  creditRecentItems,
  isExcludedClient,
  isExcludedPhone,
} = await import("../../util/apis/AdValueAttribution.js");

// Captured before beforeEach clears the mocks
const handlers = Object.fromEntries(eventsOnMock.mock.calls);
const handlerFor = (event) => handlers[event];

const client = (overrides = {}) => ({
  id: "client-1",
  name: "Test Client",
  jobberWebUri: "https://jobber.example/clients/1",
  phones: [{ number: "(555) 123-4567" }],
  tags: { nodes: [] },
  ...overrides,
});

const call = (id, start_time, overrides = {}) => ({
  id,
  start_time,
  direction: "inbound",
  value: null,
  tags: [],
  ...overrides,
});

/** Jobs and their quotes, keyed by job id, for the work-start lookup */
let jobs = {};
let quotes = {};

function invoice(id, total, jobIds, overrides = {}) {
  return {
    id,
    total,
    createdAt: new Date("2026-10-20T12:00:00Z"),
    jobberWebUri: `https://jobber.example/invoices/${id}`,
    jobIds,
    ...overrides,
  };
}

/** The last value written to a call */
const lastCallValue = (callId) =>
  updateCallMock.mock.calls.filter(([id]) => id === callId).at(-1)?.[1].value;

beforeEach(() => {
  rows = [];
  jobs = {};
  quotes = {};
  jest.clearAllMocks();
  individualSearchMock.mockResolvedValue({ results: [] });
  searchCallByPhoneMock.mockResolvedValue([]);
  searchSMSByPhoneMock.mockResolvedValue([]);
  updateCallMock.mockResolvedValue({});
  updateSMSThreadMock.mockResolvedValue({});
  findFormLeadMock.mockResolvedValue(null);
  prismaMock.job.findMany.mockImplementation(async ({ where }) =>
    where.id.in.filter((id) => jobs[id]).map((id) => jobs[id]),
  );
  prismaMock.quote.findMany.mockImplementation(async ({ where }) =>
    where.id.in.filter((id) => quotes[id]).map((id) => quotes[id]),
  );
  prismaMock.quote.findUnique.mockImplementation(
    async ({ where }) => quotes[where.id] ?? null,
  );
  prismaMock.invoice.findUnique.mockResolvedValue(null);
  delete process.env.AD_VALUE_EXCLUDED_CLIENT_TAGS;
});

describe("crediting a paid invoice", () => {
  test("a new client's call before the job gets the invoice total", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-12T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-10-11T18:09:51-04:00"),
    ]);

    await creditInvoice(client(), invoice("inv-1", 2150, ["j1"]));

    expect(searchCallByPhoneMock).toHaveBeenCalledWith("+15551234567");
    expect(updateCallMock).toHaveBeenCalledWith("CAL1", {
      value: 2150,
      note: "Client: https://jobber.example/clients/1\nInvoice: https://jobber.example/invoices/inv-1",
      customer_name: "Test Client",
      lead_status: "good_lead",
    });
    expect(rows).toEqual([
      expect.objectContaining({
        itemId: "inv-1",
        contactId: "CAL1",
        value: 2150,
      }),
    ]);
  });

  test("a diagnostic and the repair that follows add up", async () => {
    jobs.diag = {
      createdAt: new Date("2026-10-02T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    jobs.repair = {
      createdAt: new Date("2026-10-06T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-10-02T09:00:00-04:00"),
    ]);

    await creditInvoice(client(), invoice("diag-inv", 150, ["diag"]));
    expect(lastCallValue("CAL1")).toBe(150);

    await creditInvoice(client(), invoice("repair-inv", 2495, ["repair"]));
    expect(lastCallValue("CAL1")).toBe(2645);
  });

  test("a deposit counts when paid, then its invoice replaces it", async () => {
    quotes.q1 = {
      createdAt: new Date("2026-09-18T17:00:00Z"),
      jobberWebUri: "https://jobber.example/quotes/q1",
    };
    jobs.j1 = {
      createdAt: new Date("2026-09-28T15:00:00Z"),
      quoteId: "q1",
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-09-18T12:12:00-04:00"),
    ]);

    await creditDeposit(client(), {
      id: "dep-1",
      amount: 1247.5,
      entryDate: new Date("2026-09-28T13:47:27Z"),
      quoteId: "q1",
      invoiceId: null,
    });
    expect(lastCallValue("CAL1")).toBe(1247.5);

    // The $2,495 invoice already includes the deposit
    await creditInvoice(client(), invoice("inv-1", 2495, ["j1"]));
    expect(lastCallValue("CAL1")).toBe(2495);
    expect(rows.map((r) => r.itemId)).toEqual(["inv-1"]);
  });

  test("a deposit on an invoice that's already paid isn't credited separately", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ invoiceStatus: "paid" });

    await creditDeposit(client(), {
      id: "dep-1",
      amount: 500,
      entryDate: new Date(),
      quoteId: "q1",
      invoiceId: "inv-1",
    });

    expect(searchCallByPhoneMock).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  test("a returning client's scheduled job with no contact before it isn't credited", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-20T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    // Their call was about earlier work, two months before
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL-old", "2026-08-15T10:00:00-04:00"),
    ]);

    await creditInvoice(client(), invoice("inv-2", 900, ["j1"]));

    expect(updateCallMock).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  test("a returning client's ad call credits only the new work", async () => {
    jobs.old = {
      createdAt: new Date("2026-03-01T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    jobs.new = {
      createdAt: new Date("2026-10-21T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL-ad", "2026-10-20T10:00:00-04:00", { gclid: "g1" }),
    ]);

    await creditInvoice(client(), invoice("old-inv", 20000, ["old"]));
    await creditInvoice(client(), invoice("new-inv", 650, ["new"]));

    expect(updateCallMock).toHaveBeenCalledTimes(1);
    expect(lastCallValue("CAL-ad")).toBe(650);
  });

  test("a contract client (Billout tag) is never credited", async () => {
    await creditInvoice(
      client({ tags: { nodes: [{ label: "Billout" }] } }),
      invoice("inv-1", 1000, []),
    );

    expect(searchCallByPhoneMock).not.toHaveBeenCalled();
    expect(updateCallMock).not.toHaveBeenCalled();
  });

  test("the earliest contact in the window wins over a later call", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-13T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL-local", "2026-10-13T09:00:00-04:00"),
      call("CAL-asset", "2026-10-11T18:09:51-04:00", { gclid: "g1" }),
    ]);

    await creditInvoice(client(), invoice("inv-1", 2150, ["j1"]));

    expect(updateCallMock).toHaveBeenCalledTimes(1);
    expect(updateCallMock.mock.calls[0][0]).toBe("CAL-asset");
  });

  test("our own outbound call isn't the contact", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-13T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL-out", "2026-10-10T09:00:00-04:00", { direction: "outbound" }),
      call("CAL-in", "2026-10-12T09:00:00-04:00"),
    ]);

    await creditInvoice(client(), invoice("inv-1", 300, ["j1"]));

    expect(updateCallMock.mock.calls[0][0]).toBe("CAL-in");
  });

  test("a form before the first call is credited instead of CallRail", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-13T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    const lead = {
      leadId: "lead-1",
      createdAt: new Date("2026-10-10T14:00:00Z"),
    };
    findFormLeadMock.mockResolvedValue(lead);
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-10-11T09:00:00-04:00"),
    ]);

    await creditInvoice(client(), invoice("inv-1", 970, ["j1"]));

    expect(sendFormValueMock).toHaveBeenCalledWith(lead, 970);
    expect(updateCallMock).not.toHaveBeenCalled();
    const { from, until } = findFormLeadMock.mock.calls[0][1];
    expect(until - from).toBe(30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
  });

  test("an SMS thread is credited only when there's no call or form", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-13T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchSMSByPhoneMock.mockResolvedValue([
      { id: "sms-old", last_message_at: "2026-08-01T10:00:00Z" },
      { id: "sms-1", last_message_at: "2026-10-12T10:00:00Z" },
    ]);

    await creditInvoice(client(), invoice("inv-1", 225, ["j1"]));

    expect(updateSMSThreadMock).toHaveBeenCalledWith("sms-1", {
      value: 225,
      notes: expect.stringContaining(
        "Invoice: https://jobber.example/invoices/inv-1",
      ),
      lead_qualification: "good_lead",
    });
  });

  test("the same invoice is only credited once", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-12T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-10-11T18:00:00-04:00"),
    ]);

    await creditInvoice(client(), invoice("inv-1", 500, ["j1"]));
    await creditInvoice(client(), invoice("inv-1", 500, ["j1"]));

    expect(updateCallMock).toHaveBeenCalledTimes(1);
  });

  test("a value set by hand in CallRail is left alone", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-12T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-10-11T18:00:00-04:00", { value: 400 }),
    ]);

    await creditInvoice(client(), invoice("inv-1", 500, ["j1"]));

    expect(updateCallMock).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  test("a value the old code set for an earlier invoice is kept and added to", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-14T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-10-11T18:00:00-04:00", {
        value: 150,
        tags: [{ name: "invoice-paid" }],
        note: "Client: x\nInvoice: https://jobber.example/invoices/diag",
      }),
    ]);

    await creditInvoice(client(), invoice("repair", 2000, ["j1"]));

    expect(lastCallValue("CAL1")).toBe(2150);
  });

  test("a value the old code set for this same invoice isn't counted twice", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-12T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-10-11T18:00:00-04:00", {
        value: 1625,
        tags: [{ name: "invoice-paid" }],
        note: "Client: x\nInvoice: https://jobber.example/invoices/inv-1",
      }),
    ]);

    await creditInvoice(client(), invoice("inv-1", 1625, ["j1"]));

    expect(lastCallValue("CAL1")).toBe(1625);
  });

  test("a failed CallRail write leaves the invoice uncredited so it's retried", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-12T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-10-11T18:00:00-04:00"),
    ]);
    updateCallMock.mockRejectedValue(new Error("CallRail update failed: 500"));

    await expect(
      creditInvoice(client(), invoice("inv-1", 500, ["j1"])),
    ).rejects.toThrow();

    expect(rows).toEqual([]);
  });

  test("work start is the earliest of the jobs and their quotes", async () => {
    quotes.q1 = { createdAt: new Date("2026-09-01T15:00:00Z") };
    jobs.j1 = {
      createdAt: new Date("2026-10-12T15:00:00Z"),
      quoteId: "q1",
      quotes: [],
    };
    // 35 days before the job, but 6 days before the quote
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-08-26T10:00:00-04:00"),
    ]);

    await creditInvoice(client(), invoice("inv-1", 800, ["j1"]));

    expect(lastCallValue("CAL1")).toBe(800);
  });
});

describe("contract clients", () => {
  test("Billout is excluded by default, and the list can be changed", () => {
    expect(isExcludedClient({ tags: ["Billout"] })).toBe(true);
    expect(isExcludedClient(client())).toBe(false);

    process.env.AD_VALUE_EXCLUDED_CLIENT_TAGS = "Contract, No Ad Value";
    expect(isExcludedClient({ tags: ["Billout"] })).toBe(false);
    expect(
      isExcludedClient({ tags: { nodes: [{ label: "No Ad Value" }] } }),
    ).toBe(true);
  });

  test("a caller's number is matched against tagged clients' phones", async () => {
    prismaMock.client.findMany.mockResolvedValue([
      { phones: [{ number: "(770) 555-0100" }] },
    ]);

    await expect(isExcludedPhone("+17705550100")).resolves.toBe(true);
    await expect(isExcludedPhone("+17705550199")).resolves.toBe(false);
    expect(prismaMock.client.findMany.mock.calls[0][0].where).toEqual({
      tags: { hasSome: ["Billout"] },
    });
  });

  test("a failed lookup doesn't block the conversion", async () => {
    prismaMock.client.findMany.mockRejectedValue(new Error("db down"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(isExcludedPhone("+17705550100")).resolves.toBe(false);
  });
});

describe("creditRecentItems", () => {
  test("credits deposits before invoices, skipping anything already credited", async () => {
    quotes.q1 = {
      createdAt: new Date("2026-10-01T15:00:00Z"),
      jobberWebUri: "q",
    };
    jobs.j1 = {
      createdAt: new Date("2026-10-01T15:00:00Z"),
      quoteId: "q1",
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-09-30T10:00:00-04:00"),
    ]);
    prismaMock.payment.findMany.mockResolvedValue([
      {
        id: "dep-1",
        amount: 300,
        entryDate: new Date(),
        quote: "q1",
        invoice: null,
      },
    ]);
    prismaMock.invoice.findMany.mockResolvedValue([
      invoice("inv-1", 1200, undefined),
      invoice("inv-done", 999, undefined),
    ]);
    prismaMock.jobsOnInvoices.findMany.mockResolvedValue([{ jobId: "j1" }]);
    rows.push({
      itemId: "inv-done",
      contactId: "CAL-other",
      value: 999,
      itemKind: "invoice",
    });

    await creditRecentItems(client());

    expect(
      updateCallMock.mock.calls.map(([id, { value }]) => [id, value]),
    ).toEqual([
      ["CAL1", 300],
      ["CAL1", 1200],
    ]);
  });

  test("does nothing for a client with no recent paid work", async () => {
    prismaMock.payment.findMany.mockResolvedValue([]);
    prismaMock.invoice.findMany.mockResolvedValue([]);

    await creditRecentItems(client());

    expect(searchCallByPhoneMock).not.toHaveBeenCalled();
  });
});

describe("webhook events", () => {
  test("a paid invoice event uses the Jobber invoice's own jobs", async () => {
    jobs.j1 = {
      createdAt: new Date("2026-10-12T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockResolvedValue([
      call("CAL1", "2026-10-11T18:00:00-04:00"),
    ]);

    await handlerFor("ad-value-INVOICE")({
      id: "inv-1",
      client: client(),
      amounts: { total: 640 },
      createdAt: "2026-10-14T12:00:00Z",
      jobberWebUri: "https://jobber.example/invoices/inv-1",
      jobs: { nodes: [{ id: "j1" }] },
    });

    expect(lastCallValue("CAL1")).toBe(640);
  });

  test("errors are reported, not thrown back to the webhook", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jobs.j1 = {
      createdAt: new Date("2026-10-12T15:00:00Z"),
      quoteId: null,
      quotes: [],
    };
    searchCallByPhoneMock.mockRejectedValue(
      new Error("CallRail search failed"),
    );

    await expect(
      handlerFor("ad-value-DEPOSIT")({
        id: "dep-1",
        client: client(),
        amount: 100,
        entryDate: "2026-10-12T15:00:00Z",
        quote: null,
        invoice: null,
      }),
    ).resolves.toBeUndefined();
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});
