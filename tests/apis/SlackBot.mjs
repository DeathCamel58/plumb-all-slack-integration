import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const sentryMock = { captureException: jest.fn() };
const profileGetMock = jest.fn();
const postMessageMock = jest.fn();
const eventsOnMock = jest.fn();
const historyMock = jest.fn();
const listChannelsMock = jest.fn();
const markCallBadLeadMock = jest.fn();
const usersInfoMock = jest.fn();
const postEphemeralMock = jest.fn();

jest.unstable_mockModule("@slack/bolt", () => ({
  default: {
    App: class {
      constructor() {
        this.client = {
          users: { profile: { get: profileGetMock }, info: usersInfoMock },
          chat: {
            postMessage: postMessageMock,
            postEphemeral: postEphemeralMock,
          },
          conversations: { history: historyMock, list: listChannelsMock },
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
jest.unstable_mockModule("../../util/apis/CallRailBadLead.js", () => ({
  callIdFromCallRailMessage: (text) =>
    text?.match(/event_id=(CAL[0-9a-f]+)/)?.[1] ?? null,
  markCallBadLead: markCallBadLeadMock,
}));

const { event: handleEvent, handleInteractivity } =
  await import("../../util/apis/SlackBot.js");

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

describe("bad lead flags on CallRail call posts", () => {
  const CALL_LOGS = "C099BJP2HTK";
  const POST_TS = "1793302487.155679";
  const callPost = {
    ts: POST_TS,
    text: "&gt; *New Call* - <https://app.callrail.com/analytics/a/1/events/PER1?event_id=CAL01abc&amp;event_type=call|Plumb-All> (4s)",
  };
  const reaction = (reaction, ts = POST_TS) => ({
    body: {
      event: {
        type: "reaction_added",
        user: "U1",
        reaction,
        item: { channel: CALL_LOGS, ts },
      },
    },
  });

  beforeEach(() => {
    process.env.SLACK_CALL_LOGS = CALL_LOGS;
    postMessageMock.mockResolvedValue({ ok: true });
    usersInfoMock.mockResolvedValue({ user: { is_admin: true } });
    markCallBadLeadMock.mockResolvedValue({
      duplicate: false,
      callRail: "marked",
      conversions: [{ label: "call conversion", status: "retracted" }],
      validateOnly: false,
    });
  });

  test("an X on a call post marks the call and replies in its thread", async () => {
    historyMock.mockResolvedValue({ messages: [callPost] });

    await handleEvent(reaction("x"));

    expect(markCallBadLeadMock).toHaveBeenCalledWith({
      callId: "CAL01abc",
      trigger: "X reaction by <@U1>",
    });
    const reply = postMessageMock.mock.calls[0][0];
    expect(reply.channel).toBe(CALL_LOGS);
    expect(reply.thread_ts).toBe(POST_TS);
    expect(reply.text).toContain("marked *not a lead* in CallRail");
    expect(reply.text).toContain("Google Ads call conversion retracted");
  });

  test("an X from a non-admin does nothing but tell them why", async () => {
    historyMock.mockResolvedValue({ messages: [callPost] });
    usersInfoMock.mockResolvedValue({
      user: { is_admin: false, is_owner: false },
    });

    await handleEvent(reaction("x"));

    expect(usersInfoMock).toHaveBeenCalledWith({ user: "U1" });
    expect(markCallBadLeadMock).not.toHaveBeenCalled();
    expect(postMessageMock).not.toHaveBeenCalled();
    const note = postEphemeralMock.mock.calls[0][0];
    expect(note.user).toBe("U1");
    expect(note.text).toContain("Only Slack admins");
  });

  test("an X from the workspace owner counts", async () => {
    historyMock.mockResolvedValue({ messages: [callPost] });
    usersInfoMock.mockResolvedValue({
      user: { is_admin: false, is_owner: true },
    });

    await handleEvent(reaction("x"));

    expect(markCallBadLeadMock).toHaveBeenCalled();
  });

  test("other reactions leave the call alone", async () => {
    historyMock.mockResolvedValue({ messages: [callPost] });

    await handleEvent(reaction("+1"));

    expect(markCallBadLeadMock).not.toHaveBeenCalled();
  });

  test("an X on a thread reply doesn't flag the post above it", async () => {
    // history returns the newest top-level message at or before the reply
    historyMock.mockResolvedValue({ messages: [callPost] });

    await handleEvent(reaction("x", "1793302490.000100"));

    expect(markCallBadLeadMock).not.toHaveBeenCalled();
  });

  test("an X in another channel is ignored", async () => {
    historyMock.mockResolvedValue({ messages: [callPost] });
    const event = reaction("x");
    event.body.event.item.channel = "C028B6C1NRW";

    await handleEvent(event);

    expect(markCallBadLeadMock).not.toHaveBeenCalled();
  });

  test("deleting a call post marks the call and reports in the channel", async () => {
    await handleEvent({
      body: {
        event: {
          type: "message",
          subtype: "message_deleted",
          channel: CALL_LOGS,
          previous_message: callPost,
        },
      },
    });

    expect(markCallBadLeadMock).toHaveBeenCalledWith({
      callId: "CAL01abc",
      trigger: "call post deleted",
    });
    const note = postMessageMock.mock.calls[0][0];
    expect(note.thread_ts).toBeUndefined();
    expect(note.text).toContain("Deleted call post (CAL01abc)");
  });

  test("a second flag on the same call posts nothing", async () => {
    historyMock.mockResolvedValue({ messages: [callPost] });
    markCallBadLeadMock.mockResolvedValue({ duplicate: true });

    await handleEvent(reaction("x"));

    expect(postMessageMock).not.toHaveBeenCalled();
  });
});
