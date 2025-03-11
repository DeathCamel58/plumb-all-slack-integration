const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");
const events = require("../events");

/**
 * Processes a CloudFlare Contact form webhook
 * @param req the data that was received
 * @returns {Promise<void>}
 * @constructor
 */
async function ContactFormHandle(req) {
  let body = req.body;

  if (process.env.DEBUG === "TRUE") {
    console.log("Data was");
    console.log(body);
  }

  let contact = new Contact(
    "Message From Website",
    body.name,
    body.phone,
    undefined,
    body.email,
    body.address,
    body.message,
    "Website",
  );

  // Send the request to where it needs to go
  await APICoordinator.contactMade(contact, JSON.stringify(body));
}
events.emitter.on("cloudflare-contact-form", ContactFormHandle);
