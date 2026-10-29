import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const sentryMock = { captureException: jest.fn() };
const profileGetMock = jest.fn();
const postMessageMock = jest.fn();
const eventsOnMock = jest.fn();

jest.unstable_mockModule("@slack/bolt", () => ({
  default: {
    App: class {
      constructor() {
        this.client = {
          users: { profile: { get: profileGetMock } },
          chat: { postMessage: postMessageMock },
        };
      }
      async start() {}
    },
  },
}));
jest.unstable_mockModule("@sentry/node", () => sentryMock);
jest.unstable_mockModule("../../util/events.js", () => ({
  default: { emit: jest.fn(), on: eventsOnMock },
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

// Captured before beforeEach clears the mocks
const handlers = Object.fromEntries(eventsOnMock.mock.calls);

/** A button click, which first looks up the clicking user's profile */
const click = (action_id = "jobs") => ({
  body: {
    payload: {
      type: "block_actions",
      user: { id: "U1" },
      actions: [{ action_id }],
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

  test("a click on a Jobber link button is ignored without a warning", async () => {
    profileGetMock.mockResolvedValue({ ok: true, profile: {} });

    await handleInteractivity(click("open-jobber-link"));

    expect(console.warn).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });
});

describe("website form review", () => {
  test("every form is posted to call-logs with the reCAPTCHA result and a send button", async () => {
    process.env.SLACK_CALL_LOGS = "call-logs";
    postMessageMock.mockResolvedValue({ ok: true });
    const receivedAt = new Date("2026-10-27T17:08:00Z");

    await handlers["slackbot-send-website-form-review"](
      { name: "Jane Doe", phone: "555-123-4567", message: "Leaking pipe" },
      "passed reCAPTCHA, score 0.9",
      receivedAt,
    );

    const post = postMessageMock.mock.calls[0][0];
    expect(post.channel).toBe("call-logs");
    expect(post.text).toContain(
      "Website form (passed reCAPTCHA, score 0.9). Review it, and send it as a contact if it's real.",
    );
    const button = post.blocks[1].elements[0];
    expect(button.action_id).toBe("send-website-contact-0");
    expect(JSON.parse(button.value)).toEqual({
      form: {
        name: "Jane Doe",
        phone: "555-123-4567",
        message: "Leaking pipe",
      },
      receivedAt: "2026-10-27T17:08:00.000Z",
    });
  });
});
