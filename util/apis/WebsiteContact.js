const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");
const events = require("../events");
const { CheckRecaptcha } = require("./Recaptcha");

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
events.emitter.on("website-contact", WebsiteContactHandle);
