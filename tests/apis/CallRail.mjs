import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const fetchMock = jest.fn();

jest.unstable_mockModule("node-fetch", () => ({
  default: fetchMock,
}));

process.env.CALLRAIL_API_KEY = "test-api-key";
process.env.CALLRAIL_ACCOUNT_ID = "test-account-id";

const {
  getCallDetails,
  listCallsWithValueAndGclid,
  searchCallByPhone,
  searchSMSByPhone,
  updateCall,
} = await import("../../util/apis/CallRail.js");

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
  fetchMock.mockReset();
});

describe("CallRail", () => {
  test("Call search covers all time and asks for the fields attribution needs", async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ calls: [{ id: "call-1" }] }),
    );

    await expect(searchCallByPhone("+15551234567")).resolves.toEqual([
      { id: "call-1" },
    ]);

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("/calls.json?search=%2B15551234567");
    // Without it, CallRail only searches the last 7 days
    expect(url).toContain("date_range=all_time");
    for (const field of ["gclid", "value", "lead_status", "tags", "note"]) {
      expect(url).toContain(field);
    }
  });

  test("SMS search asks for each thread's value and qualification", async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ sms_threads: [{ id: "sms-1" }] }),
    );

    await expect(searchSMSByPhone("+15551234567")).resolves.toEqual([
      { id: "sms-1" },
    ]);

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("/sms-threads.json?search=%2B15551234567");
    expect(url).toContain("value");
    expect(url).toContain("lead_qualification");
  });

  test("Search failure throws", async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse(null, false, 500));

    await expect(searchCallByPhone("+15551234567")).rejects.toThrow(
      "CallRail search failed",
    );
  });

  test("updateCall sends the value, note and invoice-paid tag", async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ id: "call-42" }));

    await updateCall("call-42", {
      value: 250,
      note: "Client: c\nInvoice: i",
      customer_name: "Test Client",
      lead_status: "good_lead",
    });

    expect(fetchMock.mock.calls[0][0]).toContain("/calls/call-42.json");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      customer_name: "Test Client",
      value: "250",
      note: "Client: c\nInvoice: i",
      tags: ["invoice-paid"],
      append_tags: true,
      lead_status: "good_lead",
    });
  });

  test("getCallDetails finds a caller's source from any date", async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        calls: [
          {
            id: "call-1",
            start_time: "2026-01-05T10:00:00Z",
            source: "Google Ads",
            gclid: "gclid-1",
          },
        ],
      }),
    );

    await expect(getCallDetails("(555) 123-4567")).resolves.toEqual({
      source: "Google Ads",
      gclid: "gclid-1",
    });
    expect(fetchMock.mock.calls[0][0]).toContain("date_range=all_time");
  });

  test("The value backfill lists calls from the last 55 days, not CallRail's default week", async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({
        total_pages: 1,
        calls: [
          { id: "call-1", value: "100", gclid: "g1" },
          { id: "call-2", value: null, gclid: "g2" },
        ],
      }),
    );

    const calls = await listCallsWithValueAndGclid();

    const startDate = new URL(fetchMock.mock.calls[0][0]).searchParams.get(
      "start_date",
    );
    const daysBack = (Date.now() - new Date(startDate)) / (24 * 60 * 60 * 1000);
    expect(daysBack).toBeGreaterThan(54);
    expect(daysBack).toBeLessThan(57);
    expect(calls.map((call) => call.id)).toEqual(["call-1"]);
  });
});
