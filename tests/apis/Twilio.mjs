import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const fetchMock = jest.fn();
const eventsEmitMock = jest.fn();
const resolveUserByPhoneNumberMock = jest.fn();
const sendMessageBlocksMock = jest.fn();
const uploadFileMock = jest.fn();
const captureExceptionMock = jest.fn();

const txFindFirstMock = jest.fn();
const txUpdateManyMock = jest.fn();

const prismaMock = {
  twilioNumber: {
    update: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
  },
  twilioContact: {
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(async (arg) => {
    if (typeof arg === "function") {
      return arg({
        twilioNumber: {
          findFirst: txFindFirstMock,
          updateMany: txUpdateManyMock,
        },
      });
    }

    return Promise.all(arg);
  }),
};

const incomingPhoneNumbersListMock = jest.fn();
const callsCreateMock = jest.fn();
const callsListMock = jest.fn();
const callsFetchMock = jest.fn();
const callRecordingsCreateMock = jest.fn();
const recordingRemoveMock = jest.fn();

const callsMock = jest.fn(() => ({
  recordings: {
    create: callRecordingsCreateMock,
  },
  fetch: callsFetchMock,
}));
callsMock.create = callsCreateMock;
callsMock.list = callsListMock;

const clientMock = {
  incomingPhoneNumbers: {
    list: incomingPhoneNumbersListMock,
  },
  calls: callsMock,
  messages: {
    create: jest.fn(),
  },
  recordings: jest.fn(() => ({
    remove: recordingRemoveMock,
  })),
};

class VoiceResponse {
  constructor() {
    this.ops = [];
  }

  say(message) {
    this.ops.push(["say", message]);
    return this;
  }

  dial(options = {}, number) {
    if (number !== undefined) {
      this.ops.push(["dial", options, number]);
      return this;
    }

    const parent = this;
    return {
      number(arg1, arg2) {
        if (arg2 === undefined) {
          parent.ops.push(["dial-number", {}, arg1]);
        } else {
          parent.ops.push(["dial-number", arg1, arg2]);
        }
      },
    };
  }

  gather(options) {
    this.ops.push(["gather", options]);
    const parent = this;
    return {
      say(message) {
        parent.ops.push(["gather-say", message]);
      },
    };
  }

  pause(options) {
    this.ops.push(["pause", options]);
    return this;
  }

  reject() {
    this.ops.push(["reject"]);
    return this;
  }

  hangup() {
    this.ops.push(["hangup"]);
    return this;
  }

  record(options) {
    this.ops.push(["record", options]);
    return this;
  }

  toString() {
    return JSON.stringify(this.ops);
  }
}

class MessagingResponse {
  toString() {
    return "<Response></Response>";
  }
}

jest.unstable_mockModule("node-fetch", () => ({
  default: fetchMock,
}));

jest.unstable_mockModule("../../util/prismaClient.js", () => ({
  default: prismaMock,
}));

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: eventsEmitMock,
    on: jest.fn(),
  },
}));

jest.unstable_mockModule("../../util/apis/SlackBot.js", () => ({
  resolveUserByPhoneNumber: resolveUserByPhoneNumberMock,
  sendMessageBlocks: sendMessageBlocksMock,
  uploadFile: uploadFileMock,
}));

jest.unstable_mockModule("@sentry/node", () => ({
  captureException: captureExceptionMock,
  captureMessage: jest.fn(),
}));

const twilioFactoryMock = jest.fn(() => clientMock);
twilioFactoryMock.twiml = {
  VoiceResponse,
  MessagingResponse,
};

jest.unstable_mockModule("twilio", () => ({
  default: twilioFactoryMock,
}));

incomingPhoneNumbersListMock.mockResolvedValue([
  { phoneNumber: "+15550001111" },
  { phoneNumber: "+15550002222" },
]);
prismaMock.twilioNumber.upsert.mockResolvedValue({});

const Twilio = await import("../../util/apis/Twilio.js");

beforeEach(() => {
  process.env.WEB_URL = "https://example.test";
  process.env.TWILIO_FALLBACK_NUMBER = "+15559990000";
  process.env.TWILIO_CALLER_ID = "+15551112222";
  process.env.SLACK_CHANNEL = "C123";

  fetchMock.mockReset();
  eventsEmitMock.mockClear();
  resolveUserByPhoneNumberMock.mockReset();
  sendMessageBlocksMock.mockReset();
  uploadFileMock.mockReset();
  captureExceptionMock.mockReset();

  prismaMock.twilioNumber.update.mockReset();
  prismaMock.twilioNumber.findMany.mockReset();
  prismaMock.twilioNumber.findFirst.mockReset();
  prismaMock.twilioNumber.findUnique.mockReset();
  prismaMock.twilioNumber.updateMany.mockReset();
  prismaMock.twilioContact.update.mockReset();
  prismaMock.twilioContact.updateMany.mockReset();
  prismaMock.twilioContact.upsert.mockReset();
  prismaMock.twilioContact.findUnique.mockReset();
  prismaMock.twilioContact.findFirst.mockReset();
  prismaMock.$transaction.mockClear();

  txFindFirstMock.mockReset();
  txUpdateManyMock.mockReset();

  callsCreateMock.mockReset();
  callsListMock.mockReset();
  callsFetchMock.mockReset();
  callRecordingsCreateMock.mockReset();
  recordingRemoveMock.mockReset();

  sendMessageBlocksMock.mockResolvedValue({ ts: "123.456" });
  resolveUserByPhoneNumberMock.mockResolvedValue({
    id: "U123",
    profile: { first_name: "Alex", display_name: "", real_name: "Alex Doe" },
  });
  prismaMock.twilioContact.upsert.mockResolvedValue({});
  prismaMock.twilioContact.update.mockResolvedValue({});
  prismaMock.twilioContact.updateMany.mockResolvedValue({ count: 0 });
});

describe("Twilio", () => {
  test("unassignNumber clears assignment fields", async () => {
    prismaMock.twilioNumber.update.mockResolvedValue({});

    await Twilio.unassignNumber("+15550001111");

    expect(prismaMock.twilioNumber.update).toHaveBeenCalledWith({
      where: { id: "+15550001111" },
      data: {
        assignedEmployee: null,
        assignedEmployeeNumber: null,
        assignedEmployeeName: null,
      },
    });
  });

  test("getOrAssignEmployeeNumber returns existing assigned number", async () => {
    txFindFirstMock.mockResolvedValueOnce({ phoneNumber: "+15550001111" });

    const result = await Twilio.getOrAssignEmployeeNumber("(555) 000-1234");

    expect(result).toEqual({ phoneNumber: "+15550001111" });
    expect(txUpdateManyMock).not.toHaveBeenCalled();
  });

  test("getOrAssignEmployeeNumber assigns first available unassigned number", async () => {
    txFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "+15550002222",
        phoneNumber: "+15550002222",
      });
    txUpdateManyMock.mockResolvedValue({ count: 1 });
    prismaMock.twilioNumber.updateMany.mockResolvedValue({ count: 1 });

    const result = await Twilio.getOrAssignEmployeeNumber("5550009999");

    expect(result).toEqual({ phoneNumber: "+15550002222" });
    expect(txUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "+15550002222",
        assignedEmployeeNumber: null,
      },
      data: {
        assignedEmployeeNumber: "+15550009999",
      },
    });
  });

  test("getOrAssignEmployeeNumber throws when no Twilio numbers are available", async () => {
    txFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(
      Twilio.getOrAssignEmployeeNumber("5550009999"),
    ).rejects.toThrow(
      "No available Twilio numbers to assign. Please add more numbers to the TwilioNumber table.",
    );

    expect(eventsEmitMock).toHaveBeenCalledWith(
      "slackbot-send-message",
      expect.stringContaining("I can't assign a phone number to a user"),
      "Call Bot Twilio Number Error",
    );
  });

  test("updateTwilioContact upserts using E.164-normalized numbers", async () => {
    await Twilio.updateTwilioContact("555-444-3333", "(555) 000-1111", "1.2");

    // Upsert should set slackThreadId on create but NOT on update
    // (to prevent overwriting the original thread with a reply ts)
    expect(prismaMock.twilioContact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "+15554443333" },
        create: expect.objectContaining({
          id: "+15554443333",
          clientNumber: "+15554443333",
          twilioNumberId: "+15550001111",
          slackThreadId: "1.2",
        }),
      }),
    );
    // update should NOT contain slackThreadId
    const upsertCall = prismaMock.twilioContact.upsert.mock.calls[0][0];
    expect(upsertCall.update).not.toHaveProperty("slackThreadId");

    // Separate updateMany should set slackThreadId only where it's null
    expect(prismaMock.twilioContact.updateMany).toHaveBeenCalledWith({
      where: { id: "+15554443333", slackThreadId: null },
      data: { slackThreadId: "1.2" },
    });
  });

  test("handleInboundScreen returns screening TwiML", () => {
    const twiml = Twilio.handleInboundScreen({}, {});

    expect(twiml).toContain("/twilio/voice/screen/confirm");
    expect(twiml).toContain("To accept the call, press 1");
  });

  test("handleInboundCall without To routes to fallback number", async () => {
    const twiml = await Twilio.handleInboundCall({ body: { From: "+15554443333" } }, {});

    expect(twiml).toContain("+15559990000");
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
