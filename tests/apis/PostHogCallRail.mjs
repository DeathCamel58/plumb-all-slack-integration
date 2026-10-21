import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const fetchMock = jest.fn();
const sentryMock = { captureException: jest.fn() };
const eventsOnMock = jest.fn();

jest.unstable_mockModule("node-fetch", () => ({ default: fetchMock }));
jest.unstable_mockModule("@sentry/node", () => sentryMock);
jest.unstable_mockModule("../../util/events.js", () => ({
  default: { emit: jest.fn(), on: eventsOnMock },
}));
jest.unstable_mockModule("../../util/apis/GoogleMaps.js", () => ({
  searchPlace: jest.fn(),
}));
jest.unstable_mockModule("../../util/apis/CallRail.js", () => ({
  getCallDetails: jest.fn(),
}));

process.env.POSTHOG_HOST = "https://posthog.test";
process.env.POSTHOG_TOKEN = "phc_test";
const { logCallRailCall } = await import("../../util/apis/PostHog.js");

const CALL = {
  resource_id: "CAL123",
  customer_phone_number: "+14045551234",
  direction: "inbound",
  duration: "94",
  answered: true,
  first_call: true,
  gclid: "CjwKCAjwTest",
  medium: "cpc",
  campaign: "Septic",
  source: "Google Ads",
  source_name: "Google Ads",
  tracking_phone_number: "+17705550100",
  start_time: "2026-10-21T09:15:00.000-04:00",
};

const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

/** Routes PostHog API calls: phone search, person lookup, captures. */
function posthog({ phoneIds = [], existingSource } = {}) {
  fetchMock.mockImplementation(async (url, options) => {
    if (url.includes("/query")) return json({ results: phoneIds.map((id) => [id]) });
    if (url.includes("distinct_id=")) {
      return json({ results: [{ properties: existingSource === undefined ? {} : { callrailSource: existingSource } }] });
    }
    return json({ status: 1 });
  });
}
const captures = () =>
  fetchMock.mock.calls
    .filter(([url]) => url.endsWith("/capture/"))
    .map(([, options]) => JSON.parse(options.body));

beforeEach(() => {
  fetchMock.mockReset();
  sentryMock.captureException.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
});

describe("logCallRailCall", () => {
  test("registers on the posthog-log-callrail-call event", () => {
    expect(eventsOnMock).toHaveBeenCalledWith("posthog-log-callrail-call", logCallRailCall);
  });

  test("captures a 'callrail call' event with the source, at the call's start time", async () => {
    posthog({ phoneIds: ["client-1"], existingSource: "Google Ads" });

    await logCallRailCall(CALL);

    const event = captures().find((c) => c.event === "callrail call");
    expect(event.timestamp).toBe(CALL.start_time);
    expect(event.properties).toEqual({
      distinct_id: "client-1",
      source: "Google Ads",
      medium: "cpc",
      campaign: "Septic",
      firstCall: true,
      answered: true,
      durationSeconds: 94,
      direction: "inbound",
      hasGclid: true,
      trackingNumber: "+17705550100",
      callId: "CAL123",
    });
    expect(JSON.stringify(event.properties)).not.toContain("4045551234");
  });

  test("sets latest and first source, and keeps an existing callrailSource", async () => {
    posthog({ phoneIds: ["client-1"], existingSource: "Plumb-All Local" });

    await logCallRailCall(CALL);

    const identify = captures().find((c) => c.event === "$identify");
    expect(identify.distinct_id).toBe("client-1");
    expect(identify.$set).toEqual({ latestCallrailSource: "Google Ads", latestCallrailMedium: "cpc" });
    expect(identify.$set_once).toEqual({ firstCallrailSource: "Google Ads" });
  });

  test('fills in callrailSource when the paid lookup had found "none"', async () => {
    posthog({ phoneIds: ["client-1"], existingSource: "none" });
    await logCallRailCall(CALL);
    expect(captures().find((c) => c.event === "$identify").$set.callrailSource).toBe("Google Ads");
  });

  test("a caller PostHog doesn't know yet is keyed by their E.164 phone, like other new contacts", async () => {
    posthog({ phoneIds: [] });

    await logCallRailCall(CALL);

    const identify = captures().find((c) => c.event === "$identify");
    expect(identify.distinct_id).toBe("+14045551234");
    expect(identify.$set.callrailSource).toBe("Google Ads");
    // No person lookup by distinct_id for a brand-new caller
    expect(fetchMock.mock.calls.some(([url]) => url.includes("distinct_id="))).toBe(false);
  });

  test("never calls the CallRail API", async () => {
    posthog({ phoneIds: ["client-1"] });
    await logCallRailCall(CALL);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([url]) => /callrail/i.test(url))).toBe(false);
  });

  test("no caller number → nothing sent", async () => {
    await logCallRailCall({ ...CALL, customer_phone_number: "" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("errors are reported, not thrown", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(logCallRailCall(CALL)).resolves.toBeUndefined();
  });
});
