import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const sentryMock = { captureException: jest.fn() };
const profileGetMock = jest.fn();

jest.unstable_mockModule("@slack/bolt", () => ({
  default: {
    App: class {
      constructor() {
        this.client = { users: { profile: { get: profileGetMock } } };
      }
      async start() {}
    },
  },
}));
jest.unstable_mockModule("@sentry/node", () => sentryMock);
jest.unstable_mockModule("../../util/events.js", () => ({
  default: { emit: jest.fn(), on: jest.fn() },
}));
jest.unstable_mockModule("../../util/prismaClient.js", () => ({ default: {} }));
jest.unstable_mockModule("../../util/apis/Jobber.js", () => ({
  findUserInvoices: jest.fn(),
  findUserJobs: jest.fn(),
}));
jest.unstable_mockModule("../../util/apis/CallRail.js", () => ({}));
jest.unstable_mockModule("../../util/apis/WebsiteContact.js", () => ({
  deliverWebsiteContact: jest.fn(),
}));
jest.unstable_mockModule("../../util/apis/Twilio.js", () => ({
  callEmployeeThenCustomer: jest.fn(),
  getOrAssignEmployeeNumber: jest.fn(),
  returnAssignedPhoneNumbers: jest.fn(),
  textCustomer: jest.fn(),
  unassignNumber: jest.fn(),
  updateTwilioContact: jest.fn(),
  updateTwilioContactTs: jest.fn(),
}));
jest.unstable_mockModule("../../util/mediaStore.js", () => ({
  hostFile: jest.fn(),
}));
jest.unstable_mockModule("../../util/apis/Deepgram.js", () => ({
  transcribeDualChannel: jest.fn(),
}));
jest.unstable_mockModule("../../util/apis/OpenAI.js", () => ({
  analyzeConversation: jest.fn(),
}));

const { handleInteractivity } = await import("../../util/apis/SlackBot.js");

/** A button click, which first looks up the clicking user's profile */
const click = () => ({
  body: {
    payload: {
      type: "block_actions",
      user: { id: "U1" },
      actions: [{ action_id: "jobs" }],
    },
  },
});

/** An error shaped like @slack/web-api's platform errors */
function platformError(code) {
  const e = new Error(`An API error occurred: ${code}`);
  e.code = "slack_webapi_platform_error";
  e.data = { ok: false, error: code };
  return e;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("Slack interactivity", () => {
  test("a modal Slack expired before it opened is only logged", async () => {
    profileGetMock.mockRejectedValue(platformError("expired_trigger_id"));

    await expect(handleInteractivity(click())).resolves.toBeUndefined();

    expect(sentryMock.captureException).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  test("any other failure is reported instead of left unhandled", async () => {
    profileGetMock.mockRejectedValue(platformError("ratelimited"));

    await expect(handleInteractivity(click())).resolves.toBeUndefined();

    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});
