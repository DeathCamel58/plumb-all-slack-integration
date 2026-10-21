import fetch from "node-fetch";

const recaptchaSecretKey = process.env.RECAPTCHA_SECRET_KEY;
const recaptchaEndpoint = `https://www.google.com/recaptcha/api/siteverify?secret=${recaptchaSecretKey}`;
const recaptchaScoreThreshold = process.env.RECAPTCHA_SCORE_THRESHOLD;

/**
 * Verifies a recaptcha token and explains a failure.
 * @param token The recaptcha token
 * @param action The expected recaptcha action
 * @returns {Promise<{ok: boolean, reason: string|null, score: number|null}>}
 *   reason is a short, human-readable cause when ok is false
 */
export async function VerifyRecaptcha(token, action) {
  if (process.env.NODE_ENV === "development") {
    return { ok: true, reason: null, score: null };
  }

  if (!token) {
    console.error("Recaptcha: No token was sent");
    return { ok: false, reason: "no reCAPTCHA token", score: null };
  }

  let response = await fetch(
    `${recaptchaEndpoint}&response=${encodeURIComponent(token)}`,
  );
  const recaptchaResponse = await response.json();

  if (recaptchaResponse.success) {
    const score = recaptchaResponse.score ?? null;
    if (recaptchaResponse.action === action) {
      if (score >= recaptchaScoreThreshold) {
        return { ok: true, reason: null, score };
      } else {
        console.error("Recaptcha: Score too low: ", recaptchaResponse);
        return {
          ok: false,
          reason: `low reCAPTCHA score (${score}, needs ${recaptchaScoreThreshold})`,
          score,
        };
      }
    } else {
      console.error(
        `Recaptcha: Wrong action (expected "${action}"): `,
        recaptchaResponse,
      );
      return {
        ok: false,
        reason: `wrong reCAPTCHA action (${recaptchaResponse.action})`,
        score,
      };
    }
  }

  console.error("Recaptcha: Response isn't successful: ", recaptchaResponse);
  const codes = recaptchaResponse["error-codes"] ?? [];
  const reason = codes.includes("timeout-or-duplicate")
    ? "reCAPTCHA token expired or reused"
    : codes.length
      ? `reCAPTCHA error (${codes.join(", ")})`
      : "reCAPTCHA check failed";
  return { ok: false, reason, score: null };
}

/**
 * Verifies that the recaptcha token is valid and meets our standards
 * @returns {Promise<boolean>}
 * @constructor
 * @param token The recaptcha token
 * @param action The expected recaptcha action
 */
export async function CheckRecaptcha(token, action) {
  return (await VerifyRecaptcha(token, action)).ok;
}
