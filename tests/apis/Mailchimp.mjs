import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();
const getClientDataMock = jest.fn();
const createListMemberEventMock = jest.fn();

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: eventsEmitMock,
    on: eventsOnMock,
  },
}));

jest.unstable_mockModule("../../util/apis/Jobber.js", () => ({
  getClientData: getClientDataMock,
}));

jest.unstable_mockModule("@mailchimp/mailchimp_marketing", () => ({
  default: {
    setConfig: jest.fn(),
    lists: {
      createListMemberEvent: createListMemberEventMock,
    },
  },
}));

process.env.MAILCHIMP_API_KEY = "testapikey-us1";
process.env.MAILCHIMP_LIST_ID = "list123";

await import("../../util/apis/Mailchimp.js");

// Capture the handler registered by Mailchimp.js
const mailchimpHandler = eventsOnMock.mock.calls.find(
  ([name]) => name === "mailchimp-INVOICE_CREATE_UPDATE",
)[1];

const mockClient = {
  id: "client-id-1",
  name: "Test Client",
  emails: [{ address: "test@example.com", primary: true }],
};

beforeEach(() => {
  eventsEmitMock.mockReset();
  getClientDataMock.mockReset();
  createListMemberEventMock.mockReset();

  getClientDataMock.mockResolvedValue(mockClient);
});

describe("Mailchimp", () => {
  test("Valid client data triggers Mailchimp event", async () => {
    createListMemberEventMock.mockResolvedValue({ status: 204 });

    const invoiceData = {
      client: {
        id: "client-id-1",
        emails: [{ address: "test@example.com", primary: true }],
      },
    };

    await mailchimpHandler(invoiceData);

    expect(getClientDataMock).toHaveBeenCalledWith("client-id-1");
    expect(createListMemberEventMock).toHaveBeenCalledWith(
      "list123",
      "test@example.com",
      { name: "invoice_made" },
    );
  });

  test("Client with no primary email sends undefined email", async () => {
    createListMemberEventMock.mockResolvedValue({ status: 204 });

    const invoiceData = {
      client: {
        id: "client-id-2",
        emails: [],
      },
    };

    await mailchimpHandler(invoiceData);

    expect(createListMemberEventMock).toHaveBeenCalledWith(
      "list123",
      undefined,
      { name: "invoice_made" },
    );
  });

  test("Mailchimp API error is caught and does not throw", async () => {
    createListMemberEventMock.mockRejectedValue(new Error("Mailchimp API error"));

    const invoiceData = {
      client: {
        id: "client-id-1",
        emails: [{ address: "test@example.com", primary: true }],
      },
    };

    await expect(mailchimpHandler(invoiceData)).resolves.not.toThrow();
  });
});
