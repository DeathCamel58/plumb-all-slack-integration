const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");
const events = require("../events");
const fetch = require("node-fetch");

const recaptchaSecretKey = process.env.RECAPTCHA_SECRET_KEY;
const recaptchaEndpoint = `https://www.google.com/recaptcha/api/siteverify?secret=${recaptchaSecretKey}`;
const recaptchaScoreThreshold = process.env.RECAPTCHA_SCORE_THRESHOLD;

/**
 * Processes a website contact form webhook
 * @param data The incoming web data
 * @returns {Promise<void>}
 * @constructor
 */
async function AlertHandle(data) {
  if (process.env.DEBUG === "TRUE") {
    console.log("WebsiteContact: Data was");
    console.log(data);
  }

  if ("recaptchaToken" in data) {
    const token = data["recaptchaToken"];
    let response = await fetch(`${recaptchaEndpoint}&response=${token}`);
    const recaptchaResponse = await response.json();

    if (recaptchaResponse.success) {
      if (recaptchaResponse.action === "contact_form") {
        if (recaptchaResponse.score >= recaptchaScoreThreshold) {
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
          console.error(
            "WebsiteContact: Recaptcha score too low: ",
            recaptchaResponse,
          );
        }
      } else {
        console.error(
          "WebsiteContact: Wrong action (expected `contact_form`): ",
          recaptchaResponse,
        );
      }
    } else {
      console.error(
        "WebsiteContact: Recaptcha response isn't successful: ",
        recaptchaResponse,
      );
    }
  } else {
    console.error("WebsiteContact: Missing recaptchaToken!");
  }
}
events.emitter.on("website-contact", AlertHandle);
