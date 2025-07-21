import Contact from "../contact.js";
import * as APICoordinator from "../APICoordinator.js";
import events from "../events.js";

/**
 * Takes in a lead from SASO,
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function leadHandle(req) {
  let body = JSON.parse(req.body);

  let message = "";
  if (body.ticket_message) {
    message += body.ticket_message;
  }
  if (body.agent_notes) {
    if (message !== "") {
      message += " - ";
      message += body.agent_notes;
    }
  }

  let contact = new Contact(
    "Call",
    `${body.first_name} ${body.last_name}`,
    body.main_phone_number,
    body.caller_id,
    undefined,
    body.address,
    message,
    body.call_source,
  );

  // Send the request to where it needs to go
  await APICoordinator.contactMade(contact, JSON.stringify(body));
}
events.on("saso-lead", leadHandle);
