const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");
const events = require("../events");

/**
 * Processes a Verisae Ingles webhook
 * @param data The incoming web data
 * @returns {Promise<void>}
 * @constructor
 */
async function AlertHandle(data) {
    if (process.env.DEBUG === "TRUE") {
        console.log("Data was");
        console.log(data);
    }

    let contact = new Contact("Message From Website", data["form_data"]["name"], data["form_data"]["phone"], undefined, data["form_data"]["email"], data["form_data"]["address"], data["form_data"]["message"], "Website");

    await APICoordinator.contactMade(contact, JSON.stringify(data));
}
events.emitter.on('website-contact', AlertHandle);
