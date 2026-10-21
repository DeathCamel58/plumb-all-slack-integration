import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const fetchMock = jest.fn();
jest.unstable_mockModule("node-fetch", () => ({ default: fetchMock }));

process.env.RECAPTCHA_SCORE_THRESHOLD = "0.7";
const { VerifyRecaptcha, CheckRecaptcha } = await import(
  "../../util/apis/Recaptcha.js"
);

const google = (body) => fetchMock.mockResolvedValue({ json: async () => body });

beforeEach(() => {
  fetchMock.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("VerifyRecaptcha", () => {
  test("a good token passes", async () => {
    google({ success: true, action: "contact_form", score: 0.9 });
    await expect(VerifyRecaptcha("tok", "contact_form")).resolves.toEqual({
      ok: true,
      reason: null,
      score: 0.9,
    });
    await expect(CheckRecaptcha("tok", "contact_form")).resolves.toBe(true);
  });

  test("no token fails without calling Google", async () => {
    await expect(VerifyRecaptcha("", "contact_form")).resolves.toMatchObject({
      ok: false,
      reason: "no reCAPTCHA token",
    });
    await expect(VerifyRecaptcha(undefined, "contact_form")).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an expired token says so", async () => {
    google({ success: false, "error-codes": ["timeout-or-duplicate"] });
    await expect(VerifyRecaptcha("old", "contact_form")).resolves.toMatchObject({
      ok: false,
      reason: "reCAPTCHA token expired or reused",
    });
  });

  test("a low score reports the score and threshold", async () => {
    google({ success: true, action: "contact_form", score: 0.3 });
    const verdict = await VerifyRecaptcha("tok", "contact_form");
    expect(verdict).toMatchObject({ ok: false, score: 0.3 });
    expect(verdict.reason).toBe("low reCAPTCHA score (0.3, needs 0.7)");
    await expect(CheckRecaptcha("tok", "contact_form")).resolves.toBe(false);
  });

  test("a token for another form's action fails", async () => {
    google({ success: true, action: "feedback_form", score: 0.9 });
    await expect(VerifyRecaptcha("tok", "contact_form")).resolves.toMatchObject({
      ok: false,
      reason: "wrong reCAPTCHA action (feedback_form)",
    });
  });

  test("other Google errors are listed", async () => {
    google({ success: false, "error-codes": ["browser-error"] });
    await expect(VerifyRecaptcha("tok", "contact_form")).resolves.toMatchObject({
      ok: false,
      reason: "reCAPTCHA error (browser-error)",
    });
  });
});
