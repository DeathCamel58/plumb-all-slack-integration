import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();
const createListMemberEventMock = jest.fn();
const sentryMock = { captureException: jest.fn() };

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: eventsEmitMock,
    on: eventsOnMock,
  },
}));

jest.unstable_mockModule("@sentry/node", () => sentryMock);

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

const invoiceFor = (emails) => ({ client: { id: "client-id-1", emails } });

/** An error shaped like the Mailchimp SDK's (superagent) errors. */
function mailchimpError(status, detail) {
  const e = new Error(detail);
  e.status = status;
  e.response = { body: { status, detail } };
  return e;
}

let logSpy, errorSpy;

beforeEach(() => {
  eventsEmitMock.mockReset();
  createListMemberEventMock.mockReset();
  createListMemberEventMock.mockResolvedValue({ status: 204 });
  sentryMock.captureException.mockReset();
  logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("Mailchimp", () => {
  test("Sends the event to the client's primary email", async () => {
    await mailchimpHandler(
      invoiceFor([
        { address: "other@example.com", primary: false },
        { address: "test@example.com", primary: true },
      ]),
    );

    expect(createListMemberEventMock).toHaveBeenCalledWith(
      "list123",
      "test@example.com",
      { name: "invoice_made" },
    );
  });

  test("Falls back to the first email when none is primary", async () => {
    await mailchimpHandler(
      invoiceFor([{ address: "first@example.com", primary: false }]),
    );

    expect(createListMemberEventMock).toHaveBeenCalledWith(
      "list123",
      "first@example.com",
      { name: "invoice_made" },
    );
  });

  test("Client with no email is skipped without calling Mailchimp", async () => {
    await mailchimpHandler(invoiceFor([]));

    expect(createListMemberEventMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("Email not on the list (404) is skipped quietly", async () => {
    createListMemberEventMock.mockRejectedValue(
      mailchimpError(404, "The requested resource could not be found."),
    );

    await mailchimpHandler(invoiceFor([{ address: "a@b.com", primary: true }]));

    expect(errorSpy).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  test("Other API errors are reported and do not throw", async () => {
    createListMemberEventMock.mockRejectedValue(
      mailchimpError(500, "Internal error"),
    );

    await expect(
      mailchimpHandler(invoiceFor([{ address: "a@b.com", primary: true }])),
    ).resolves.toBeUndefined();
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Mailchimp: Error sending invoice_made event for a@b.com:",
      500,
      "Internal error",
    );
  });
});
