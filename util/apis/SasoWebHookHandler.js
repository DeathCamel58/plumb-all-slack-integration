const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");

/**
 * Takes in a lead from SASO,
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function leadHandle(req) {
    let body = req.body;

    let message = body.message;
    if (body.message === '') {
        message = body.agent_notes;
    }

    let contact = new Contact("Call", `${body.first_name} ${body.last_name}`, body.phone_number, body.called_from, undefined, body.address, message, body.call_source);

    // Send the request to where it needs to go
    await APICoordinator.contactMade(contact, JSON.stringify(body));
}

module.exports = {
    leadHandle
};
