const fetch = require("node-fetch");

const recaptchaSecretKey = process.env.RECAPTCHA_SECRET_KEY;
const recaptchaEndpoint = `https://www.google.com/recaptcha/api/siteverify?secret=${recaptchaSecretKey}`;
const recaptchaScoreThreshold = process.env.RECAPTCHA_SCORE_THRESHOLD;

/**
 * Verifies that the recaptcha token is valid and meets our standards
 * @returns {Promise<boolean>}
 * @constructor
 * @param token The recaptcha token
 * @param action The expected recaptcha action
 */
export async function CheckRecaptcha(token, action) {
  let response = await fetch(`${recaptchaEndpoint}&response=${token}`);
  const recaptchaResponse = await response.json();

  if (recaptchaResponse.success) {
    if (recaptchaResponse.action === action) {
      if (recaptchaResponse.score >= recaptchaScoreThreshold) {
        return true;
      } else {
        console.error("Recaptcha: Score too low: ", recaptchaResponse);
      }
    } else {
      console.error(
        `Recaptcha: Wrong action (expected "${action}"): `,
        recaptchaResponse,
      );
    }
  } else {
    console.error("Recaptcha: Response isn't successful: ", recaptchaResponse);
  }

  return false;
}
