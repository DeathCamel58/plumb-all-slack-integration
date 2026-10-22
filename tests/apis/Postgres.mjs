import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();

function modelMock() {
  return {
    findMany: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
  };
}

const prismaMock = {
  client: modelMock(),
  expense: modelMock(),
  invoice: modelMock(),
  job: modelMock(),
  jobsOnInvoices: modelMock(),
  payment: modelMock(),
  property: modelMock(),
  quote: modelMock(),
  quotesOnJobs: modelMock(),
  timeSheetEntry: modelMock(),
  user: modelMock(),
};
// Non-enumerable, so loops over the models skip it
Object.defineProperty(prismaMock, "$transaction", {
  value: (fn) => fn(prismaMock),
});

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: eventsEmitMock,
    on: eventsOnMock,
  },
}));

jest.unstable_mockModule("../../util/prismaClient.js", () => ({
  default: prismaMock,
}));

jest.unstable_mockModule("../../util/apis/Jobber.js", () => ({
  getUserData: jest.fn(),
  getPropertyData: jest.fn(),
  getJobData: jest.fn(),
  getInvoiceData: jest.fn(),
  getClientData: jest.fn(),
}));

await import("../../util/apis/Postgres.js");

const handlerFor = (event) =>
  eventsOnMock.mock.calls.find(([name]) => name === event)[1];

const jobCreateUpdate = handlerFor("db-JOB_CREATE_UPDATE");
const quoteCreateUpdate = handlerFor("db-QUOTE_CREATE_UPDATE");
const timesheetCreateUpdate = handlerFor("db-TIMESHEET_CREATE_UPDATE");
const timesheetDestroy = handlerFor("db-TIMESHEET_DESTROY");
const clientDestroy = handlerFor("db-CLIENT_DESTROY");
const jobDestroy = handlerFor("db-JOB_DESTROY");
const propertyDestroy = handlerFor("db-PROPERTY_DESTROY");
const expenseDestroy = handlerFor("db-EXPENSE_DESTROY");

/**
 * Builds a P2002 in the shape @prisma/adapter-pg produces. The driver adapter
 * does not set `meta.target`, and Postgres reports camelCase columns quoted.
 */
function uniqueViolation(...fields) {
  const error = new Error("Unique constraint failed");
  error.code = "P2002";
  error.meta = {
    driverAdapterError: {
      cause: { kind: "UniqueConstraintViolation", constraint: { fields } },
    },
  };
  return error;
}

const mockClient = {
  companyName: "Test Co",
  createdAt: "2026-01-01T00:00:00Z",
  firstName: "Test",
  id: "client-1",
  isArchivable: true,
  isArchived: false,
  isCompany: true,
  isLead: false,
  lastName: "Client",
  name: "Test Client",
  title: null,
  updatedAt: "2026-01-02T00:00:00Z",
  jobberWebUri: "https://jobber.example/client-1",
};

const mockJob = {
  allowReviewRequest: true,
  client: mockClient,
  completedAt: "2026-01-03T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  endAt: "2026-01-03T01:00:00Z",
  id: "job-1",
  instructions: null,
  invoices: { nodes: [] },
  jobNumber: 1234,
  jobStatus: "active",
  jobType: "ONE_OFF",
  jobberWebUri: "https://jobber.example/job-1",
  property: { id: "property-1" },
  salesperson: null,
  startAt: "2026-01-03T00:00:00Z",
  title: "Test Job",
  total: 100,
  uninvoicedTotal: 0,
  updatedAt: "2026-01-02T00:00:00Z",
  willClientBeAutomaticallyCharged: false,
};

const mockQuote = {
  amounts: {
    depositAmount: 0,
    discountAmount: 0,
    nonTaxAmount: 0,
    outstandingDepositAmount: 0,
    subtotal: 100,
    taxAmount: 0,
    total: 100,
  },
  approvedAt: null,
  changesRequestedAt: null,
  client: { id: "client-1" },
  clientHubUri: "https://clienthub.example/quote-1",
  clientHubViewedAt: null,
  contractDisclaimer: null,
  convertedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  depositAmountUnallocated: 0,
  id: "quote-1",
  jobberWebUri: "https://jobber.example/quote-1",
  jobs: { nodes: [] },
  message: null,
  property: { id: "property-1" },
  quoteNumber: "42",
  quoteStatus: "draft",
  salesperson: null,
  title: "Test Quote",
  totalTaxAmount: 0,
  updatedAt: "2026-01-02T00:00:00Z",
};

beforeEach(() => {
  for (const model of Object.values(prismaMock)) {
    for (const method of Object.values(model)) {
      method.mockReset();
      method.mockResolvedValue(undefined);
    }
  }
  // Every `ensure*Exists` lookup finds an existing row, so nothing recurses out
  // to the Jobber API.
  for (const model of Object.values(prismaMock)) {
    model.findMany.mockResolvedValue([{ id: "exists" }]);
  }
});

describe("jobCreateUpdate", () => {
  test("recovers from a jobNumber conflict by updating that row", async () => {
    prismaMock.job.upsert.mockRejectedValue(uniqueViolation('"jobNumber"'));

    await jobCreateUpdate(mockJob);

    expect(prismaMock.job.update).toHaveBeenCalledTimes(1);
    const args = prismaMock.job.update.mock.calls[0][0];
    expect(args.where).toEqual({ jobNumber: 1234 });
    // The surviving row takes over the incoming id
    expect(args.data.id).toBe("job-1");
  });

  test("recovers when the conflict names the index instead of the column", async () => {
    prismaMock.job.upsert.mockRejectedValue(uniqueViolation("jobs_pk"));

    await jobCreateUpdate(mockJob);

    expect(prismaMock.job.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobNumber: 1234 } }),
    );
  });

  test("recovers from a concurrent insert of the same job", async () => {
    prismaMock.job.upsert.mockRejectedValue(uniqueViolation("id"));

    await jobCreateUpdate(mockJob);

    const args = prismaMock.job.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "job-1" });
    expect(args.data.id).toBeUndefined();
  });

  test("still handles the legacy meta.target shape", async () => {
    const error = new Error("Unique constraint failed");
    error.code = "P2002";
    error.meta = { target: ["jobNumber"] };
    prismaMock.job.upsert.mockRejectedValue(error);

    await jobCreateUpdate(mockJob);

    expect(prismaMock.job.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobNumber: 1234 } }),
    );
  });

  test("rethrows unrelated errors", async () => {
    const error = new Error("connection lost");
    error.code = "P1001";
    prismaMock.job.upsert.mockRejectedValue(error);

    await expect(jobCreateUpdate(mockJob)).rejects.toThrow("connection lost");
    expect(prismaMock.job.update).not.toHaveBeenCalled();
  });
});

describe("quoteCreateUpdate", () => {
  test("recovers from a concurrent insert of the same quote", async () => {
    prismaMock.quote.upsert.mockRejectedValue(uniqueViolation("id"));

    await quoteCreateUpdate(mockQuote);

    expect(prismaMock.quote.update).toHaveBeenCalledTimes(1);
    const args = prismaMock.quote.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "quote-1" });
    expect(args.data.id).toBeUndefined();
  });

  test("rethrows a conflict on any other field", async () => {
    prismaMock.quote.upsert.mockRejectedValue(uniqueViolation('"quoteNumber"'));

    await expect(quoteCreateUpdate(mockQuote)).rejects.toMatchObject({
      code: "P2002",
    });
    expect(prismaMock.quote.update).not.toHaveBeenCalled();
  });
});

// A "General" entry with no note or job, as in PLUMB-ALL-SLACK-INTEGRATION-54.
const mockTimesheet = {
  approved: false,
  approvedBy: null,
  client: null,
  createdAt: "2026-10-08T12:00:00Z",
  endAt: "2026-10-08T13:00:00Z",
  finalDuration: 3600,
  id: "timesheet-1",
  job: null,
  label: "General",
  labourRate: 25,
  note: null,
  paidBy: null,
  startAt: "2026-10-08T12:00:00Z",
  ticking: false,
  updatedAt: "2026-10-08T13:00:00Z",
  user: { id: "user-1" },
  visit: null,
  visitDurationTotal: null,
};

describe("timesheetCreateUpdate", () => {
  test("stores a null note as null", async () => {
    await timesheetCreateUpdate(mockTimesheet);

    const { create, update } =
      prismaMock.timeSheetEntry.upsert.mock.calls[0][0];
    expect(create.note).toBeNull();
    expect(update.note).toBeNull();
    expect(create.endAt).toEqual(new Date("2026-10-08T13:00:00Z"));
  });

  test("stores a running timer's missing endAt as null, not the epoch", async () => {
    await timesheetCreateUpdate({
      ...mockTimesheet,
      endAt: null,
      ticking: true,
    });

    const { create } = prismaMock.timeSheetEntry.upsert.mock.calls[0][0];
    expect(create.endAt).toBeNull();
    expect(create.startAt).toEqual(new Date("2026-10-08T12:00:00Z"));
  });

  test("catches a failed upsert instead of rejecting", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    prismaMock.timeSheetEntry.upsert.mockRejectedValue(new Error("boom"));

    await expect(timesheetCreateUpdate(mockTimesheet)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("timesheetDestroy", () => {
  test("catches a failed delete instead of rejecting", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    prismaMock.timeSheetEntry.deleteMany.mockRejectedValue(new Error("boom"));

    await expect(timesheetDestroy("timesheet-1")).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("clientDestroy", () => {
  /** Records the order of every delete/update across models. */
  let calls;

  beforeEach(() => {
    calls = [];
    for (const [name, model] of Object.entries(prismaMock)) {
      model.findMany.mockReset().mockResolvedValue([]);
      model.deleteMany
        .mockReset()
        .mockImplementation(
          async () => (calls.push(`${name}.delete`), { count: 1 }),
        );
      model.updateMany
        .mockReset()
        .mockImplementation(
          async () => (calls.push(`${name}.update`), { count: 0 }),
        );
    }
    prismaMock.quote.findMany.mockResolvedValue([{ id: "quote-1" }]);
    prismaMock.job.findMany.mockResolvedValue([{ id: "job-1" }]);
    prismaMock.invoice.findMany.mockResolvedValue([{ id: "invoice-1" }]);
  });

  test("deletes link rows and payments before the quotes, jobs and invoices they point at", async () => {
    await clientDestroy("client-1");

    const before = (a, b) =>
      expect(calls.indexOf(a)).toBeLessThan(calls.indexOf(b));
    before("quotesOnJobs.delete", "quote.delete");
    before("quotesOnJobs.delete", "job.delete");
    before("jobsOnInvoices.delete", "job.delete");
    before("jobsOnInvoices.delete", "invoice.delete");
    before("payment.delete", "invoice.delete");
    before("timeSheetEntry.update", "job.delete");
    before("expense.update", "job.delete");
    before("property.delete", "client.delete");
    expect(calls.at(-1)).toBe("client.delete");

    expect(prismaMock.quotesOnJobs.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ quoteId: { in: ["quote-1"] } }, { jobId: { in: ["job-1"] } }],
      },
    });
    expect(prismaMock.payment.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ client: "client-1" }, { invoice: { in: ["invoice-1"] } }],
      },
    });
  });

  test("keeps timesheets and expenses, clearing their client and job", async () => {
    await clientDestroy("client-1");

    expect(prismaMock.timeSheetEntry.updateMany).toHaveBeenCalledWith({
      where: { client: "client-1" },
      data: { client: null },
    });
    expect(prismaMock.timeSheetEntry.updateMany).toHaveBeenCalledWith({
      where: { job: { in: ["job-1"] } },
      data: { job: null },
    });
    expect(prismaMock.expense.updateMany).toHaveBeenCalledWith({
      where: { linkedJob: { in: ["job-1"] } },
      data: { linkedJob: null },
    });
    expect(prismaMock.timeSheetEntry.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.expense.deleteMany).not.toHaveBeenCalled();
  });

  test("catches a failed delete instead of rejecting", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.quote.deleteMany.mockRejectedValue(new Error("FK violation"));

    await expect(clientDestroy("client-1")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("jobDestroy", () => {
  beforeEach(() => {
    for (const model of Object.values(prismaMock)) {
      model.deleteMany.mockReset().mockResolvedValue({ count: 1 });
      model.updateMany.mockReset().mockResolvedValue({ count: 0 });
    }
  });

  test("is wired to JOB_DESTROY and deletes the job, not an invoice", async () => {
    await jobDestroy("job-1");

    expect(prismaMock.job.deleteMany).toHaveBeenCalledWith({
      where: { id: "job-1" },
    });
    expect(prismaMock.invoice.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.quotesOnJobs.deleteMany).toHaveBeenCalledWith({
      where: { jobId: "job-1" },
    });
    expect(prismaMock.jobsOnInvoices.deleteMany).toHaveBeenCalledWith({
      where: { jobId: "job-1" },
    });
  });

  test("keeps timesheets and expenses, clearing their job", async () => {
    await jobDestroy("job-1");

    expect(prismaMock.timeSheetEntry.updateMany).toHaveBeenCalledWith({
      where: { job: "job-1" },
      data: { job: null },
    });
    expect(prismaMock.expense.updateMany).toHaveBeenCalledWith({
      where: { linkedJob: "job-1" },
      data: { linkedJob: null },
    });
  });

  test("catches a failed delete instead of rejecting", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.job.deleteMany.mockRejectedValue(new Error("FK violation"));

    await expect(jobDestroy("job-1")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("propertyDestroy", () => {
  beforeEach(() => {
    for (const model of Object.values(prismaMock)) {
      model.deleteMany.mockReset().mockResolvedValue({ count: 1 });
    }
  });

  test("is wired to PROPERTY_DESTROY and deletes the property", async () => {
    await propertyDestroy("property-1");

    expect(prismaMock.property.deleteMany).toHaveBeenCalledWith({
      where: { id: "property-1" },
    });
  });

  test("EXPENSE_DESTROY only deletes the expense", async () => {
    await expenseDestroy("expense-1");

    expect(prismaMock.expense.deleteMany).toHaveBeenCalled();
    expect(prismaMock.property.deleteMany).not.toHaveBeenCalled();
  });

  test("catches a failed delete instead of rejecting", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.property.deleteMany.mockRejectedValue(new Error("FK violation"));

    await expect(propertyDestroy("property-1")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
