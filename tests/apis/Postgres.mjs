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
