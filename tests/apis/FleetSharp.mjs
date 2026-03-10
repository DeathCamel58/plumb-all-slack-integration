import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: eventsEmitMock,
    on: eventsOnMock,
  },
}));

await import("../../util/apis/FleetSharp.js");

// Capture the AlertHandle registered by FleetSharp.js
const alertHandler = eventsOnMock.mock.calls.find(
  ([name]) => name === "fleetsharp-alert",
)[1];

function makeReq(body) {
  return { body: JSON.stringify(body) };
}

beforeEach(() => {
  eventsEmitMock.mockReset();
  process.env.SLACK_CHANNEL_GENERAL = "C-general";
  process.env.MATTERMOST_CHANNEL_GENERAL = "town-square";
});

describe("FleetSharp", () => {
  test("HIGH_SPEED alert emits Slack and Mattermost messages", async () => {
    const req = makeReq({
      alertCode: "HIGH_SPEED",
      firstName: "John",
      lastName: "Doe",
      vin: "1HGBH41JXMN109186",
    });

    await alertHandler(req);

    expect(eventsEmitMock).toHaveBeenCalledWith(
      "slackbot-send-message",
      expect.stringContaining("John Doe"),
      "FleetSharp Alert",
      "C-general",
    );
    expect(eventsEmitMock).toHaveBeenCalledWith(
      "mattermost-send-message",
      expect.stringContaining("John Doe"),
      "FleetSharp Alert",
      "town-square",
    );
  });

  test("Non-HIGH_SPEED alert does not emit Slack/Mattermost messages", async () => {
    const req = makeReq({
      alertCode: "HARSH_BRAKING",
      firstName: "Jane",
      lastName: "Smith",
      vin: "1HGBH41JXMN109186",
    });

    await alertHandler(req);

    const messageCalls = eventsEmitMock.mock.calls.filter(
      ([event]) => event === "slackbot-send-message" || event === "mattermost-send-message",
    );
    expect(messageCalls.length).toBe(0);
  });

  test("HIGH_SPEED alert message contains VIN", async () => {
    const req = makeReq({
      alertCode: "HIGH_SPEED",
      firstName: "Test",
      lastName: "Driver",
      vin: "TESTVIN1234567890",
    });

    await alertHandler(req);

    const slackCall = eventsEmitMock.mock.calls.find(
      ([event]) => event === "slackbot-send-message",
    );
    expect(slackCall).toBeDefined();
    expect(slackCall[1]).toContain("TESTVIN1234567890");
  });

  test("Missing fields in body do not crash handler", async () => {
    const req = makeReq({ alertCode: "HIGH_SPEED" });

    await expect(alertHandler(req)).resolves.not.toThrow();
  });
});
