import Contact from "../contact.js";
import * as APICoordinator from "../APICoordinator.js";
import events from "../events.js";
import { CheckRecaptcha } from "./Recaptcha.js";

/**
 * Processes a website contact form webhook
 * @param data The incoming web data
 * @returns {Promise<void>}
 * @constructor
 */
async function WebsiteContactHandle(data) {
  if (process.env.DEBUG === "TRUE") {
    console.log("WebsiteContact: Data was");
    console.log(data);
  }

  if ("recaptchaToken" in data) {
    if (await CheckRecaptcha(data["recaptchaToken"], "contact_form")) {
      let contact = new Contact(
        "Message From Website",
        data["name"],
        data["phone"],
        undefined,
        data["email"],
        data["address"],
        data["message"],
        "Website",
      );

      await APICoordinator.contactMade(contact, JSON.stringify(data));
    } else {
      console.error("WebsiteContact: Bad recaptcha");
    }
  }
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
