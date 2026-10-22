import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const fetchMock = jest.fn();
const sentryMock = { captureException: jest.fn(), captureMessage: jest.fn() };

jest.unstable_mockModule("node-fetch", () => ({ default: fetchMock }));
jest.unstable_mockModule("@sentry/node", () => sentryMock);
jest.unstable_mockModule("../../util/events.js", () => ({
  default: { emit: jest.fn(), on: jest.fn() },
}));
jest.unstable_mockModule("../../util/apis/GoogleMaps.js", () => ({
  searchPlace: jest.fn(),
}));
jest.unstable_mockModule("../../util/apis/CallRail.js", () => ({
  getCallDetails: jest.fn(),
}));

process.env.POSTHOG_HOST = "https://posthog.test";
process.env.POSTHOG_TOKEN = "phc_test";
const PostHog = await import("../../util/apis/PostHog.js");
const Jobber = await import("../../util/apis/Jobber.js");

const json = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const captures = () =>
  fetchMock.mock.calls
    .filter(([url]) => url.endsWith("/capture/"))
    .map(([, options]) => JSON.parse(options.body));

const INVOICE = {
  id: "Z2lkOi8vSm9iYmVyL0ludm9pY2UvMQ==",
  subject: "For Services Rendered",
  invoiceNumber: "35696",
  invoiceStatus: "paid",
  issuedDate: "2026-10-20T00:00:00Z",
  receivedDate: "2026-10-21T15:00:00Z",
  amounts: {
    depositAmount: 0,
    discountAmount: 0,
    invoiceBalance: 0,
    paymentsTotal: 500,
    subtotal: 500,
    total: 500,
  },
  salesperson: { id: "Z2lkOi8vSm9iYmVyL1VzZXIvMQ==", name: { full: "Test Tech" } },
  jobs: { nodes: [{ id: "Z2lkOi8vSm9iYmVyL0pvYi8x", jobNumber: 5187 }] },
  clientTags: ["Billout"],
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json({ status: 1 }));
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("Invoice events", () => {
  test("invoice made keeps the old keys and adds the commission fields", async () => {
    await PostHog.logInvoice(INVOICE, "client-1");

    const [event] = captures();
    expect(event.event).toBe("invoice made");
    expect(event.properties).toMatchObject({
      distinct_id: "client-1",
      subject: "For Services Rendered",
      invoiceNumber: "35696",
      depositAmount: 0,
      discountAmount: 0,
      invoiceBalance: 0,
      paymentsTotal: 500,
      subtotal: 500,
      total: 500,
      invoiceId: INVOICE.id,
      invoiceStatus: "paid",
      issuedDate: "2026-10-20T00:00:00Z",
      receivedDate: "2026-10-21T15:00:00Z",
      salespersonId: INVOICE.salesperson.id,
      salespersonName: "Test Tech",
      jobIds: ["Z2lkOi8vSm9iYmVyL0pvYi8x"],
      jobNumbers: [5187],
      clientTags: ["Billout"],
    });
  });

  test("invoice updated uses the same properties", async () => {
    await PostHog.logInvoiceUpdate(INVOICE, "client-1");

    const [event] = captures();
    expect(event.event).toBe("invoice updated");
    expect(event.properties.invoiceStatus).toBe("paid");
    expect(event.properties.jobIds).toEqual(["Z2lkOi8vSm9iYmVyL0pvYi8x"]);
  });

  test("an invoice without salesperson, jobs or tags still sends", async () => {
    const { salesperson, jobs, clientTags, ...bare } = INVOICE;
    await PostHog.logInvoice(bare, "client-1");

    const [event] = captures();
    expect(event.properties).toMatchObject({
      salespersonId: null,
      salespersonName: null,
      jobIds: [],
      jobNumbers: [],
      clientTags: null,
    });
  });
});

describe("Expense deleted", () => {
  test("sends an expense deleted event with the expense ID", async () => {
    await PostHog.logExpenseDestroy("Z2lkOi8vSm9iYmVyL0V4cGVuc2UvMQ==");

    const [event] = captures();
    expect(event.event).toBe("expense deleted");
    expect(event.properties.id).toBe("Z2lkOi8vSm9iYmVyL0V4cGVuc2UvMQ==");
  });
});

describe("Client tags", () => {
  test("returns the tag labels", async () => {
    fetchMock.mockImplementation(async () =>
      json({
        data: {
          client: { tags: { nodes: [{ label: "Billout" }, { label: "VIP" }] } },
        },
      }),
    );

    await expect(Jobber.getClientTags("client-1")).resolves.toEqual([
      "Billout",
      "VIP",
    ]);
  });

  test("returns null instead of throwing when Jobber rejects the query", async () => {
    fetchMock.mockImplementation(async () =>
      json({ errors: [{ message: "Field 'tags' doesn't exist" }] }),
    );

    await expect(Jobber.getClientTags("client-1")).resolves.toBeNull();
  });
});
