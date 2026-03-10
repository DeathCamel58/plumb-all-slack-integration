import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();
const getQuoteSearchDataMock = jest.fn();
const getJobSearchDataMock = jest.fn();
const getInvoiceSearchDataMock = jest.fn();

const getMyTeamsMock = jest.fn();
const getChannelsMock = jest.fn();
const createPostMock = jest.fn();
const searchUsersMock = jest.fn();

const addFirstConnectListenerMock = jest.fn();
const addCloseListenerMock = jest.fn();
const addMissedMessageListenerMock = jest.fn();
const addErrorListenerMock = jest.fn();
const addMessageListenerMock = jest.fn();
const wsInitializeMock = jest.fn();

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: eventsEmitMock,
    on: eventsOnMock,
  },
}));

jest.unstable_mockModule("../../util/apis/Jobber.js", () => ({
  getQuoteSearchData: getQuoteSearchDataMock,
  getJobSearchData: getJobSearchDataMock,
  getInvoiceSearchData: getInvoiceSearchDataMock,
  findOpenJobBlame: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule("node-fetch", () => ({
  default: jest.fn().mockResolvedValue({ status: 200 }),
}));

const mockClient4Instance = {
  setUrl: jest.fn(),
  setToken: jest.fn(),
  getWebSocketUrl: jest.fn().mockReturnValue("wss://mattermost.example.com/api/v4/websocket"),
  getMyTeams: getMyTeamsMock,
  getChannels: getChannelsMock,
  createPost: createPostMock,
  searchUsers: searchUsersMock,
};

const mockWebSocketClient = {
  addFirstConnectListener: addFirstConnectListenerMock,
  addCloseListener: addCloseListenerMock,
  addMissedMessageListener: addMissedMessageListenerMock,
  addErrorListener: addErrorListenerMock,
  addMessageListener: addMessageListenerMock,
  initialize: wsInitializeMock,
};

jest.unstable_mockModule("@mattermost/client", () => ({
  default: {
    Client4: jest.fn(() => mockClient4Instance),
    WebSocketClient: jest.fn(() => mockWebSocketClient),
  },
}));

jest.unstable_mockModule("ws", () => ({
  WebSocket: class MockWebSocket {},
}));

process.env.MATTERMOST_URL = "https://mattermost.example.com";
process.env.MATTERMOST_TOKEN = "test-token";
process.env.MATTERMOST_CHANNEL = "calls";

await import("../../util/apis/Mattermost.js");

// Capture the handlers registered by Mattermost.js
const sendMessageHandler = eventsOnMock.mock.calls.find(
  ([name]) => name === "mattermost-send-message",
)[1];

// Capture the WebSocket message listener
const wsMessageListener = addMessageListenerMock.mock.calls[0][0];

beforeEach(() => {
  eventsEmitMock.mockReset();
  getMyTeamsMock.mockReset();
  getChannelsMock.mockReset();
  createPostMock.mockReset();
  searchUsersMock.mockReset();
  getQuoteSearchDataMock.mockReset();
  getJobSearchDataMock.mockReset();
  getInvoiceSearchDataMock.mockReset();

  getMyTeamsMock.mockResolvedValue([{ id: "team-id-1", name: "main" }]);
  getChannelsMock.mockResolvedValue([
    { id: "channel-id-calls", name: "calls" },
    { id: "channel-id-general", name: "town-square" },
  ]);
  createPostMock.mockResolvedValue({ id: "post-id-1" });
});

describe("Mattermost", () => {
  describe("sendMessage", () => {
    test("Sends message to the correct channel", async () => {
      await sendMessageHandler("Hello Mattermost!", "Bot", "calls");

      expect(createPostMock).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: "channel-id-calls",
          message: "Hello Mattermost!",
        }),
      );
    });

    test("Logs error when channel not found", async () => {
      getChannelsMock.mockResolvedValue([]);
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      await sendMessageHandler("Test", "Bot", "nonexistent-channel");

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("findMessageReference", () => {
    function makePostEvent(message) {
      return {
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post-id-1",
            root_id: "",
            channel_id: "channel-id-calls",
            message,
          }),
        },
      };
    }

    test("QUOTE reference triggers quote lookup and reply", async () => {
      getQuoteSearchDataMock.mockResolvedValue({
        quoteNumber: 123,
        quoteStatus: "draft",
        createdAt: new Date().toISOString(),
        jobberWebUri: "https://secure.getjobber.com/quotes/123",
        client: { name: "Test Client" },
        amounts: { total: 500 },
      });

      await wsMessageListener(makePostEvent("Check out QUOTE #123"));

      expect(getQuoteSearchDataMock).toHaveBeenCalledWith("quoteNumber", "123");
      expect(createPostMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Quote #123"),
        }),
      );
    });

    test("JOB reference triggers job lookup and reply", async () => {
      getJobSearchDataMock.mockResolvedValue({
        jobNumber: 456,
        createdAt: new Date().toISOString(),
        jobberWebUri: "https://secure.getjobber.com/jobs/456",
        client: { name: "Test Client" },
        total: 750,
      });

      await wsMessageListener(makePostEvent("Look at JOB #456 please"));

      expect(getJobSearchDataMock).toHaveBeenCalledWith("456");
      expect(createPostMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Job #456"),
        }),
      );
    });

    test("INVOICE reference triggers invoice lookup and reply", async () => {
      getInvoiceSearchDataMock.mockResolvedValue({
        invoiceNumber: "789",
        createdAt: new Date().toISOString(),
        jobberWebUri: "https://secure.getjobber.com/invoices/789",
        client: { name: "Test Client" },
        amounts: { total: 1200 },
      });

      await wsMessageListener(makePostEvent("Invoice #789 is due"));

      expect(getInvoiceSearchDataMock).toHaveBeenCalledWith("789");
      expect(createPostMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Invoice #789"),
        }),
      );
    });

    test("Message with no references does not trigger any lookups", async () => {
      await wsMessageListener(makePostEvent("Just a regular message with no references"));

      expect(getQuoteSearchDataMock).not.toHaveBeenCalled();
      expect(getJobSearchDataMock).not.toHaveBeenCalled();
      expect(getInvoiceSearchDataMock).not.toHaveBeenCalled();
    });

    test("Own messages (starting with reference header) are skipped", async () => {
      await wsMessageListener(
        makePostEvent("Mattermost: Found these Jobber items referenced: QUOTE #123"),
      );

      expect(getQuoteSearchDataMock).not.toHaveBeenCalled();
    });
  });
});
