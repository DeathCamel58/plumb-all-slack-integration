import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsOnMock = jest.fn();
const getRequestDataMock = jest.fn();
const contactMadeMock = jest.fn();

jest.unstable_mockModule("../../util/events.js", () => ({
  default: { emit: jest.fn(), on: eventsOnMock },
}));
jest.unstable_mockModule("../../util/apis/Jobber.js", () => ({
  getRequestData: getRequestDataMock,
}));
jest.unstable_mockModule("../../util/apis/PostHog.js", () => ({}));
jest.unstable_mockModule("../../util/APICoordinator.js", () => ({
  contactMade: contactMadeMock,
}));
jest.unstable_mockModule("@sentry/node", () => ({
  captureException: jest.fn(),
}));

await import("../../util/apis/JobberWebHookHandler.js");

const requestCreate = eventsOnMock.mock.calls.find(
  ([name]) => name === "jobber-REQUEST_CREATE",
)[1];

const requestUpdate = eventsOnMock.mock.calls.find(
  ([name]) => name === "jobber-REQUEST_UPDATE",
)[1];

const webhook = {
  body: { data: { webHookEvent: { itemId: "request-1" } } },
  header: () => null,
};

function buildRequest(overrides = {}, clientOverrides = {}) {
  return {
    id: "request-1",
    source: "external",
    jobberWebUri: "https://secure.getjobber.com/requests/1",
    property: null,
    client: {
      id: "client-1",
      name: "Mike R.",
      phones: [],
      emails: [{ address: "abc@messaging.yelp.com" }],
      billingAddress: null,
      ...clientOverrides,
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DEBUG = "TRUE";
});

describe("Jobber request webhook", () => {
  test("a Yelp lead without a phone is marked as waiting on one", async () => {
    getRequestDataMock.mockResolvedValue(
      buildRequest({ source: "Yelp Leads " }),
    );

    await requestCreate(webhook);

    const [contact] = contactMadeMock.mock.calls[0];
    expect(contact.type).toBe("Yelp Lead");
    expect(contact.source).toBe("Yelp");
    expect(contact.phone).toBeNull();
    expect(contact.message).toContain("No phone number yet");
    expect(contact.jobberClient.id).toBe("client-1");
  });

  test("a Yelp lead with a phone isn't marked as waiting", async () => {
    getRequestDataMock.mockResolvedValue(
      buildRequest(
        { source: "Yelp Leads " },
        { phones: [{ number: "404-555-0123" }] },
      ),
    );

    await requestCreate(webhook);

    const [contact] = contactMadeMock.mock.calls[0];
    expect(contact.type).toBe("Yelp Lead");
    expect(contact.phone).toBe("(404) 555-0123");
    expect(contact.message).not.toContain("No phone number yet");
  });

  test("other requests stay Jobber requests", async () => {
    getRequestDataMock.mockResolvedValue(buildRequest());

    await requestCreate(webhook);

    const [contact] = contactMadeMock.mock.calls[0];
    expect(contact.type).toBe("Jobber Request");
    expect(contact.source).toBe("Jobber");
    expect(contact.message).not.toContain("No phone number yet");
  });

  test.each([
    "AI agent request (Claude): plumbing - drain cleaning",
    "URGENT: AI agent request (OpenAI): septic",
  ])("a booking API request (%s) isn't announced twice", async (title) => {
    getRequestDataMock.mockResolvedValue(buildRequest({ title }));

    await requestCreate(webhook);

    expect(contactMadeMock).not.toHaveBeenCalled();
  });

  test("a request deleted since the webhook is skipped, not a crash", async () => {
    getRequestDataMock.mockResolvedValue(null);

    await expect(requestCreate(webhook)).resolves.toBeUndefined();
    await expect(requestUpdate(webhook)).resolves.toBeUndefined();
    expect(contactMadeMock).not.toHaveBeenCalled();
  });

  test("a handler that throws is reported instead of rejecting", async () => {
    getRequestDataMock.mockRejectedValue(new Error("Jobber down"));

    await expect(requestCreate(webhook)).resolves.toBeUndefined();
    await expect(requestUpdate(webhook)).resolves.toBeUndefined();
  });
});
