const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");
const events = require("../events");
const fetch = require("node-fetch");

const recaptchaSecretKey = process.env.RECAPTCHA_SECRET_KEY;
const recaptchaEndpoint = `https://www.google.com/recaptcha/api/siteverify?secret=${recaptchaSecretKey}`;

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
    console.log(response.json);

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
    console.error("WebsiteContact: Missing recaptchaToken!");
  }
}
events.emitter.on("website-contact", AlertHandle);
