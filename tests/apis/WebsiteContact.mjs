import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();
const contactMadeMock = jest.fn();
const feedbackMadeMock = jest.fn();
const checkRecaptchaMock = jest.fn();

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
}));

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
});

describe("WebsiteContact", () => {
  test("Valid reCAPTCHA → contact created", async () => {
    checkRecaptchaMock.mockResolvedValue(true);
    contactMadeMock.mockResolvedValue(undefined);

    const data = {
      recaptchaToken: "valid-token",
      name: "Jane Doe",
      phone: "555-123-4567",
      email: "jane@example.com",
      address: "123 Main St",
      message: "Hello, I need help",
    };

    await contactHandler(data);

    expect(checkRecaptchaMock).toHaveBeenCalledWith("valid-token", "contact_form");
    expect(contactMadeMock).toHaveBeenCalledTimes(1);

    const [contact] = contactMadeMock.mock.calls[0];
    expect(contact.name).toBe("Jane Doe");
    expect(contact.email).toBe("jane@example.com");
  });

  test("Failed reCAPTCHA → contact not created", async () => {
    checkRecaptchaMock.mockResolvedValue(false);

    const data = {
      recaptchaToken: "bad-token",
      name: "Bad Actor",
      phone: "555-000-0000",
      email: "spam@example.com",
      message: "Spam",
    };

    await contactHandler(data);

    expect(checkRecaptchaMock).toHaveBeenCalledWith("bad-token", "contact_form");
    expect(contactMadeMock).not.toHaveBeenCalled();
  });

  test("Missing recaptchaToken → contact not created", async () => {
    const data = {
      name: "No Token",
      phone: "555-000-0000",
    };

    await contactHandler(data);

    expect(checkRecaptchaMock).not.toHaveBeenCalled();
    expect(contactMadeMock).not.toHaveBeenCalled();
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

    expect(checkRecaptchaMock).toHaveBeenCalledWith("valid-token", "feedback_form");
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
