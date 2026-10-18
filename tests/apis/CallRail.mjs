import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();
const prismaInvoiceCountMock = jest.fn();
const fetchMock = jest.fn();
const individualSearchMock = jest.fn();
const findLeadFormLeadMock = jest.fn();
const sendLeadFormValueMock = jest.fn();

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

jest.unstable_mockModule("../../util/apis/GoogleAdsLeadFormValues.js", () => ({
  findLeadFormLead: findLeadFormLeadMock,
  sendLeadFormValue: sendLeadFormValueMock,
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
    text: async () => JSON.stringify(data),
  };
}

beforeEach(() => {
  eventsEmitMock.mockReset();
  prismaInvoiceCountMock.mockReset();
  fetchMock.mockReset();
  individualSearchMock.mockReset();
  individualSearchMock.mockResolvedValue({ results: [] });
  findLeadFormLeadMock.mockReset();
  findLeadFormLeadMock.mockResolvedValue(null);
  sendLeadFormValueMock.mockReset();
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
    expect(putBody.value).toBe("250");
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

  test("No CallRail call or SMS match → searches both, no PUT", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock
      .mockResolvedValueOnce(mockFetchResponse({ calls: [] }))
      .mockResolvedValueOnce(mockFetchResponse({ sms_threads: [] }));

    await handler(makePayment(), makeInvoice());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("/calls.json?search=");
    expect(fetchMock.mock.calls[1][0]).toContain("/sms-threads.json?search=");
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

  test("Call already has value → skip call, falls back to SMS search", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock
      .mockResolvedValueOnce(
        mockFetchResponse({ calls: [{ id: "call-50", value: "150.00" }] }),
      )
      .mockResolvedValueOnce(mockFetchResponse({ sms_threads: [] }));

    await handler(makePayment(), makeInvoice());

    // Call search + SMS search, no PUT
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("/sms-threads.json");
  });

  test("Search returns multiple calls, first qualified, second not → updates second", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock
      .mockResolvedValueOnce(
        mockFetchResponse({
          calls: [
            { id: "call-A", value: "100.00", start_time: "2026-03-01T10:00:00Z" },
            { id: "call-B", value: null, start_time: "2026-03-10T10:00:00Z" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ id: "call-B", lead_status: "good_lead" }),
      );

    await handler(makePayment(), makeInvoice());

    // One search + one PUT
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("/calls/call-B.json");
  });

  test("Multiple unqualified calls → picks most recent by start_time", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock
      .mockResolvedValueOnce(
        mockFetchResponse({
          calls: [
            { id: "call-old", value: null, start_time: "2025-06-01T10:00:00Z" },
            { id: "call-new", value: null, start_time: "2026-03-20T10:00:00Z" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ id: "call-new", lead_status: "good_lead" }),
      );

    await handler(makePayment(), makeInvoice());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("/calls/call-new.json");
  });

  test("No calls found → falls back to SMS thread, qualifies it", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock
      // Call search: no results
      .mockResolvedValueOnce(mockFetchResponse({ calls: [] }))
      // SMS search: one unqualified thread
      .mockResolvedValueOnce(
        mockFetchResponse({
          sms_threads: [
            { id: "sms-1", value: null, last_message_at: "2026-03-20T10:00:00Z" },
          ],
        }),
      )
      // SMS thread update
      .mockResolvedValueOnce(
        mockFetchResponse({ id: "sms-1", lead_qualification: "good_lead" }),
      );

    await handler(makePayment(), makeInvoice());

    // Call search + SMS search + SMS PUT
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain("/calls.json?search=");
    expect(fetchMock.mock.calls[1][0]).toContain("/sms-threads.json?search=");
    expect(fetchMock.mock.calls[2][0]).toContain("/sms-threads/sms-1.json");

    let putBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(putBody.lead_qualification).toBe("good_lead");
    expect(putBody.value).toBe("250");
    expect(putBody.tags).toEqual(["invoice-paid"]);
    expect(putBody.append_tags).toBe(true);
  });

  test("No calls, SMS already qualified → no update", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock
      .mockResolvedValueOnce(mockFetchResponse({ calls: [] }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          sms_threads: [
            { id: "sms-2", value: "100.00", last_message_at: "2026-03-20T10:00:00Z" },
          ],
        }),
      );

    await handler(makePayment(), makeInvoice());

    // Call search + SMS search, no PUT
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("No calls, multiple SMS → picks most recent by last_message_at", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock
      .mockResolvedValueOnce(mockFetchResponse({ calls: [] }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          sms_threads: [
            { id: "sms-old", value: null, last_message_at: "2025-06-01T10:00:00Z" },
            { id: "sms-new", value: null, last_message_at: "2026-03-22T10:00:00Z" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ id: "sms-new", lead_qualification: "good_lead" }),
      );

    await handler(makePayment(), makeInvoice());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain("/sms-threads/sms-new.json");
  });

  test("Call exists → does NOT search SMS (no double counting)", async () => {
    prismaInvoiceCountMock.mockResolvedValue(1);
    fetchMock
      .mockResolvedValueOnce(
        mockFetchResponse({ calls: [{ id: "call-1", value: null, start_time: "2026-03-20T10:00:00Z" }] }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ id: "call-1", lead_status: "good_lead" }),
      );

    await handler(makePayment(), makeInvoice());

    // Only call search + call PUT — no SMS search
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("/calls.json");
    expect(fetchMock.mock.calls[1][0]).toContain("/calls/call-1.json");
  });

  describe("first contact gets the value", () => {
    const lead = (overrides = {}) => ({
      leadId: "lead-1",
      createdAt: new Date("2026-10-10T14:00:00Z"),
      uploadedAt: null,
      ...overrides,
    });

    test("Lead form before the first call → lead form credited, CallRail untouched", async () => {
      prismaInvoiceCountMock.mockResolvedValue(1);
      findLeadFormLeadMock.mockResolvedValue(lead());
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse({
          calls: [{ id: "call-42", start_time: "2026-10-11T09:00:00-04:00" }],
        }),
      );

      await handler(makePayment(), makeInvoice({ total: 970 }));

      expect(sendLeadFormValueMock).toHaveBeenCalledWith(lead(), 970);
      expect(fetchMock).toHaveBeenCalledTimes(1); // search only, no PUT
    });

    test("Call before the lead form → CallRail credited, lead form untouched", async () => {
      prismaInvoiceCountMock.mockResolvedValue(1);
      findLeadFormLeadMock.mockResolvedValue(lead());
      fetchMock
        .mockResolvedValueOnce(
          mockFetchResponse({
            calls: [{ id: "call-42", start_time: "2026-10-09T09:00:00-04:00" }],
          }),
        )
        .mockResolvedValueOnce(mockFetchResponse({ id: "call-42" }));

      await handler(makePayment(), makeInvoice({ total: 970 }));

      expect(sendLeadFormValueMock).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls[1][0]).toContain("/calls/call-42.json");
    });

    test("The earliest call decides, even if it already has a value", async () => {
      prismaInvoiceCountMock.mockResolvedValue(1);
      findLeadFormLeadMock.mockResolvedValue(lead());
      fetchMock
        .mockResolvedValueOnce(
          mockFetchResponse({
            calls: [
              {
                id: "call-1",
                start_time: "2026-10-01T09:00:00-04:00",
                value: "0",
              },
              { id: "call-2", start_time: "2026-10-12T09:00:00-04:00" },
            ],
          }),
        )
        .mockResolvedValueOnce(mockFetchResponse({ id: "call-2" }));

      await handler(makePayment(), makeInvoice());

      expect(sendLeadFormValueMock).not.toHaveBeenCalled();
    });

    test("Lead form with no calls → lead form credited, no SMS search", async () => {
      prismaInvoiceCountMock.mockResolvedValue(1);
      findLeadFormLeadMock.mockResolvedValue(lead());
      fetchMock.mockResolvedValueOnce(mockFetchResponse({ calls: [] }));

      await handler(makePayment(), makeInvoice({ total: 450 }));

      expect(sendLeadFormValueMock).toHaveBeenCalledWith(lead(), 450);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("No phone numbers but a lead form match (by email) → lead form credited", async () => {
      prismaInvoiceCountMock.mockResolvedValue(1);
      findLeadFormLeadMock.mockResolvedValue(lead());

      await handler(makePayment({ phones: [] }), makeInvoice({ total: 300 }));

      expect(sendLeadFormValueMock).toHaveBeenCalledWith(lead(), 300);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("A call already carrying the value blocks an unsent lead form from also getting it", async () => {
      prismaInvoiceCountMock.mockResolvedValue(1);
      findLeadFormLeadMock.mockResolvedValue(lead());
      fetchMock
        .mockResolvedValueOnce(
          mockFetchResponse({
            calls: [
              {
                id: "call-42",
                start_time: "2026-10-11T09:00:00-04:00",
                value: "970",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(mockFetchResponse({ sms_threads: [] }));

      await handler(makePayment(), makeInvoice({ total: 970 }));

      expect(sendLeadFormValueMock).not.toHaveBeenCalled();
    });

    test("A lead form already credited keeps getting restatements on re-triggers", async () => {
      prismaInvoiceCountMock.mockResolvedValue(1);
      const sent = lead({ uploadedAt: new Date(), value: "970.00" });
      findLeadFormLeadMock.mockResolvedValue(sent);
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse({
          calls: [{ id: "call-42", start_time: "2026-10-11T09:00:00-04:00" }],
        }),
      );

      await handler(makePayment(), makeInvoice({ total: 1200 }));

      expect(sendLeadFormValueMock).toHaveBeenCalledWith(sent, 1200);
    });
  });
});
