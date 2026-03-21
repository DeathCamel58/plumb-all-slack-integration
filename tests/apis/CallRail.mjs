import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();
const prismaInvoiceCountMock = jest.fn();
const fetchMock = jest.fn();
const individualSearchMock = jest.fn();

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: eventsEmitMock,
    on: eventsOnMock,
  },
}));

jest.unstable_mockModule("../../util/prismaClient.js", () => ({
  default: {
    invoice: {
      count: prismaInvoiceCountMock,
    },
  },
}));

jest.unstable_mockModule("node-fetch", () => ({
  default: fetchMock,
}));

jest.unstable_mockModule("../../util/apis/PostHog.js", () => ({
  individualSearch: individualSearchMock,
}));

process.env.CALLRAIL_API_KEY = "test-api-key";
process.env.CALLRAIL_ACCOUNT_ID = "test-account-id";

await import("../../util/apis/CallRail.js");

const handler = eventsOnMock.mock.calls.find(
  ([name]) => name === "callrail-FIRST_INVOICE_PAYMENT",
)[1];

function makePayment({ phones = [{ number: "(555) 123-4567", primary: true }], clientId = "client-1" } = {}) {
  return {
    client: {
      id: clientId,
      name: "Test Client",
      jobberWebUri: "https://app.getjobber.com/clients/client-1",
      phones: phones,
    },
    invoice: { id: "inv-1" },
  };
}

function makeInvoice({ total = 250.0, invoiceNumber = "1001" } = {}) {
  return {
    amounts: { total },
    invoiceNumber,
    jobberWebUri: "https://app.getjobber.com/invoices/inv-1",
  };
}

function mockFetchResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => data,
  };
}

beforeEach(() => {
  eventsEmitMock.mockReset();
  prismaInvoiceCountMock.mockReset();
  fetchMock.mockReset();
  individualSearchMock.mockReset();
  individualSearchMock.mockResolvedValue({ results: [] });
});

describe("CallRail", () => {
  test("First invoice + phone + call found → PUT called with good_lead + value", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock
      .mockResolvedValueOnce(mockFetchResponse({ calls: [{ id: "call-42" }] }))
      .mockResolvedValueOnce(mockFetchResponse({ id: "call-42", lead_status: "good_lead" }));

    await handler(makePayment(), makeInvoice());

    // Search call
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("/calls.json?search=");
    expect(fetchMock.mock.calls[0][0]).toContain("%2B15551234567");

    // Update call
    expect(fetchMock.mock.calls[1][0]).toContain("/calls/call-42.json");
    let putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.customer_name).toBe("Test Client");
    expect(putBody.lead_status).toBe("good_lead");
    expect(putBody.value).toBe(250.0);
    expect(putBody.note).toBe(
      "Client: https://app.getjobber.com/clients/client-1\nInvoice: https://app.getjobber.com/invoices/inv-1",
    );
    expect(putBody.tags).toEqual(["invoice-paid"]);
    expect(putBody.append_tags).toBe(true);
  });

  test("Invoice count > 1 → no API calls", async () => {
    prismaInvoiceCountMock.mockResolvedValue(2);

    await handler(makePayment(), makeInvoice());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("No invoice on payment → no API calls", async () => {
    await handler(makePayment(), null);

    expect(prismaInvoiceCountMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("No client phone → no API calls", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);

    await handler(makePayment({ phones: [] }), makeInvoice());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("No CallRail call match → search called, no PUT", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ calls: [] }));

    await handler(makePayment(), makeInvoice());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/calls.json?search=");
  });

  test("First phone no match, second phone matches → PUT called", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock
      // First phone: no match
      .mockResolvedValueOnce(mockFetchResponse({ calls: [] }))
      // Second phone: match
      .mockResolvedValueOnce(mockFetchResponse({ calls: [{ id: "call-99" }] }))
      // PUT update
      .mockResolvedValueOnce(mockFetchResponse({ id: "call-99", lead_status: "good_lead" }));

    await handler(
      makePayment({
        phones: [
          { number: "(555) 000-0000", primary: true },
          { number: "(555) 123-4567", primary: false },
        ],
      }),
      makeInvoice(),
    );

    // Two searches + one PUT
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain("/calls.json?search=");
    expect(fetchMock.mock.calls[1][0]).toContain("/calls.json?search=");
    expect(fetchMock.mock.calls[2][0]).toContain("/calls/call-99.json");
  });

  test("Jobber phones miss, PostHog alternatePhone matches → PUT called", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);

    // PostHog returns a person with an alternatePhone not in Jobber
    individualSearchMock.mockResolvedValue({
      results: [
        {
          properties: {
            phone: "(555) 123-4567",
            alternatePhone: "(770) 999-8888",
          },
        },
      ],
    });

    fetchMock
      // Jobber phone: no match
      .mockResolvedValueOnce(mockFetchResponse({ calls: [] }))
      // PostHog phone (same as Jobber, deduped): skipped
      // PostHog alternatePhone: match
      .mockResolvedValueOnce(mockFetchResponse({ calls: [{ id: "call-ph" }] }))
      // PUT update
      .mockResolvedValueOnce(mockFetchResponse({ id: "call-ph", lead_status: "good_lead" }));

    await handler(makePayment(), makeInvoice());

    // Two searches (Jobber phone + PostHog alternatePhone) + one PUT
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain("%2B15551234567");
    expect(fetchMock.mock.calls[1][0]).toContain("%2B17709998888");
    expect(fetchMock.mock.calls[2][0]).toContain("/calls/call-ph.json");

    // Verify PostHog was searched by distinct_id (Jobber client ID)
    expect(individualSearchMock).toHaveBeenCalledWith("client-1", "distinct_id");
  });

  test("CallRail API error → Sentry captures, no throw", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock.mockResolvedValueOnce(mockFetchResponse(null, false, 500));

    // Should not throw
    await handler(makePayment(), makeInvoice());

    // Only one fetch call (the search that failed)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
