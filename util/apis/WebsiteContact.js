const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");
const events = require("../events");

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
}
events.emitter.on("website-contact", AlertHandle);
