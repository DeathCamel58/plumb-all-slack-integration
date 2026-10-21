import Contact from "../contact.js";
import * as APICoordinator from "../APICoordinator.js";
import events from "../events.js";
import { CheckRecaptcha, VerifyRecaptcha } from "./Recaptcha.js";
import { recordWebsiteFormLead } from "./GoogleAdsLeadFormValues.js";

/**
 * Builds the Contact for a website contact form.
 * @param data The website contact form body
 * @returns {Contact}
 */
export function websiteContact(data) {
  return new Contact(
    "Message From Website",
    data["name"],
    data["phone"],
    undefined,
    data["email"],
    data["address"],
    data["message"],
    "Website",
  );
}

/**
 * Sends a verified website contact form to dispatch, and records it for
 * Google Ads (it counts as a lead, and can carry the customer's first invoice
 * value later).
 * @param data The website contact form body
 * @param {Date} [receivedAt] - When the form was submitted
 * @returns {Promise<void>}
 */
export async function deliverWebsiteContact(data, receivedAt = new Date()) {
  await APICoordinator.contactMade(websiteContact(data), JSON.stringify(data));
  await recordWebsiteFormLead(data, receivedAt);
}

/**
 * Processes a website contact form webhook.
 *
 * A form that passes reCAPTCHA goes to dispatch. One that fails (no token, an
 * expired token, a low score) isn't dropped: it's posted to the call-logs
 * channel with a "Send as contact" button, so someone can review it and
 * forward it if it's real. Only a filled-in honeypot field is discarded, since
 * people never see that field.
 * @param data The incoming web data
 * @returns {Promise<void>}
 * @constructor
 */
async function WebsiteContactHandle(data) {
  if (process.env.DEBUG === "TRUE") {
    console.log("WebsiteContact: Data was");
    console.log(data);
  }

  if (data?.website) {
    console.error("WebsiteContact: Honeypot field filled, discarding as spam");
    return;
  }

  const receivedAt = new Date();
  const verdict = await VerifyRecaptcha(data?.recaptchaToken, "contact_form");

  if (verdict.ok) {
    await deliverWebsiteContact(data, receivedAt);
    return;
  }

  console.error(
    `WebsiteContact: Failed reCAPTCHA (${verdict.reason}), sending to call-logs for review`,
  );
  events.emit(
    "slackbot-send-unverified-website-contact",
    data,
    verdict.reason,
    receivedAt,
  );
}
events.on("website-contact", WebsiteContactHandle);

/**
 * Processes a website negative feedback form webhook
 * @param data The incoming web data
 * @returns {Promise<void>}
 * @constructor
 */
async function WebsiteFeedbackHandle(data) {
  if (process.env.DEBUG === "TRUE") {
    console.log("WebsiteFeedback: Data was");
    console.log(data);
  }

  if ("recaptchaToken" in data) {
    if (await CheckRecaptcha(data["recaptchaToken"], "feedback_form")) {
      await APICoordinator.feedbackMade(
        data["name"],
        data["phone"],
        data["message"],
      );
    } else {
      console.error("WebsiteContact: Bad recaptcha");
    }
  }
}
events.on("website-negative-feedback", WebsiteFeedbackHandle);
