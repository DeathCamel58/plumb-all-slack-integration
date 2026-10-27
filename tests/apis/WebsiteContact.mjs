import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();
const contactMadeMock = jest.fn();
const feedbackMadeMock = jest.fn();
const checkRecaptchaMock = jest.fn();
const verifyRecaptchaMock = jest.fn();
const recordWebsiteFormLeadMock = jest.fn();

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: eventsEmitMock,
    on: eventsOnMock,
  },
}));

jest.unstable_mockModule("../../util/APICoordinator.js", () => ({
  contactMade: contactMadeMock,
  feedbackMade: feedbackMadeMock,
}));

jest.unstable_mockModule("../../util/apis/Recaptcha.js", () => ({
  CheckRecaptcha: checkRecaptchaMock,
  VerifyRecaptcha: verifyRecaptchaMock,
}));

jest.unstable_mockModule("../../util/apis/GoogleAdsLeadFormValues.js", () => ({
  recordWebsiteFormLead: recordWebsiteFormLeadMock,
}));

const { deliverWebsiteContact } =
  await import("../../util/apis/WebsiteContact.js");

// Capture the handlers registered by WebsiteContact.js
const contactHandler = eventsOnMock.mock.calls.find(
  ([name]) => name === "website-contact",
)[1];
const feedbackHandler = eventsOnMock.mock.calls.find(
  ([name]) => name === "website-negative-feedback",
)[1];

beforeEach(() => {
  eventsEmitMock.mockReset();
  contactMadeMock.mockReset();
  feedbackMadeMock.mockReset();
  checkRecaptchaMock.mockReset();
  verifyRecaptchaMock.mockReset();
  recordWebsiteFormLeadMock.mockReset();
});

describe("WebsiteContact", () => {
  const form = (overrides = {}) => ({
    recaptchaToken: "valid-token",
    name: "Jane Doe",
    phone: "555-123-4567",
    email: "jane@example.com",
    address: "123 Main St",
    message: "Hello, I need help",
    website: "",
    ...overrides,
  });
  const passed = { ok: true, reason: null, score: 0.9 };
  const reviewEmits = () =>
    eventsEmitMock.mock.calls.filter(
      ([name]) => name === "slackbot-send-website-form-review",
    );

  test("Passing reCAPTCHA → still sent to call-logs for review, not to dispatch or Google Ads", async () => {
    verifyRecaptchaMock.mockResolvedValue(passed);

    const data = form();
    await contactHandler(data);

    expect(verifyRecaptchaMock).toHaveBeenCalledWith(
      "valid-token",
      "contact_form",
    );
    expect(contactMadeMock).not.toHaveBeenCalled();
    expect(recordWebsiteFormLeadMock).not.toHaveBeenCalled();
    expect(reviewEmits()).toEqual([
      [
        "slackbot-send-website-form-review",
        data,
        "passed reCAPTCHA, score 0.9",
        expect.any(Date),
      ],
    ]);
  });

  test("Failed reCAPTCHA → sent to call-logs with the reason", async () => {
    verifyRecaptchaMock.mockResolvedValue({
      ok: false,
      reason: "reCAPTCHA token expired or reused",
      score: null,
    });

    const data = form({ recaptchaToken: "stale-token" });
    await contactHandler(data);

    expect(contactMadeMock).not.toHaveBeenCalled();
    expect(recordWebsiteFormLeadMock).not.toHaveBeenCalled();
    expect(reviewEmits()).toEqual([
      [
        "slackbot-send-website-form-review",
        data,
        "failed reCAPTCHA: reCAPTCHA token expired or reused",
        expect.any(Date),
      ],
    ]);
  });

  test("Sending a reviewed form → dispatch first, then Google Ads with the submission time", async () => {
    const order = [];
    contactMadeMock.mockImplementation(async () => order.push("dispatch"));
    recordWebsiteFormLeadMock.mockImplementation(async () =>
      order.push("google-ads"),
    );
    const submittedAt = new Date("2026-10-27T17:08:00Z");

    const data = form({ gclid: "CjwKCAjwWebsiteGCLID" });
    await deliverWebsiteContact(data, submittedAt);

    const [contact] = contactMadeMock.mock.calls[0];
    expect(contact.name).toBe("Jane Doe");
    expect(recordWebsiteFormLeadMock).toHaveBeenCalledWith(data, submittedAt);
    expect(order).toEqual(["dispatch", "google-ads"]);
  });

  test("Missing or empty recaptchaToken → still sent to call-logs (it used to be dropped)", async () => {
    verifyRecaptchaMock.mockResolvedValue({
      ok: false,
      reason: "no reCAPTCHA token",
      score: null,
    });

    const { recaptchaToken, ...noToken } = form();
    void recaptchaToken;
    await contactHandler(noToken);
    await contactHandler(form({ recaptchaToken: "" }));

    expect(verifyRecaptchaMock).toHaveBeenCalledWith(undefined, "contact_form");
    expect(verifyRecaptchaMock).toHaveBeenCalledWith("", "contact_form");
    expect(reviewEmits()).toHaveLength(2);
    expect(contactMadeMock).not.toHaveBeenCalled();
  });

  test("Honeypot filled → discarded without a reCAPTCHA check", async () => {
    await contactHandler(form({ website: "http://spam.example" }));

    expect(verifyRecaptchaMock).not.toHaveBeenCalled();
    expect(contactMadeMock).not.toHaveBeenCalled();
    expect(reviewEmits()).toHaveLength(0);
  });

  test("Valid reCAPTCHA for feedback → feedbackMade called", async () => {
    checkRecaptchaMock.mockResolvedValue(true);
    feedbackMadeMock.mockResolvedValue(undefined);

    const data = {
      recaptchaToken: "valid-token",
      name: "Unhappy Customer",
      phone: "555-987-6543",
      message: "Not satisfied with service",
    };

    await feedbackHandler(data);

    expect(checkRecaptchaMock).toHaveBeenCalledWith(
      "valid-token",
      "feedback_form",
    );
    expect(feedbackMadeMock).toHaveBeenCalledWith(
      "Unhappy Customer",
      "555-987-6543",
      "Not satisfied with service",
    );
  });

  test("Failed reCAPTCHA for feedback → feedbackMade not called", async () => {
    checkRecaptchaMock.mockResolvedValue(false);

    const data = {
      recaptchaToken: "bad-token",
      name: "Bot",
      phone: "555-000-0000",
      message: "Spam feedback",
    };

    await feedbackHandler(data);

    expect(feedbackMadeMock).not.toHaveBeenCalled();
  });
});
