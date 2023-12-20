const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");

function parseBody(body) {
    let parsed = body.split("039f7a43-a61a-4057-955b-e0d0818d3437");

    for (let i = 0; i < parsed.length; i++) {
        parsed[i] = parsed[i].replace(/^\s+|\s+$/g, '');
    }

    let data = {}

    data.first_name = parsed[0];
    data.last_name = parsed[1];
    data.phone_number = parsed[2];
    data.called_from = parsed[3];
    data.address = parsed[4];
    data.message = parsed[5];
    data.call_source = parsed[6];
    data.agent_notes = parsed[7];

    return data;
}

/**
 * Takes in a lead from SASO,
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function leadHandle(req) {
    let body = parseBody(req.body);

    let message = "";
    if (body.message) {
        message += body.message;
    }
    if (body.agent_notes) {
        if (message !== "") {
            message += " - ";
            message += body.agent_notes;
        }
    }

    let contact = new Contact("Call", `${body.first_name} ${body.last_name}`, body.phone_number, body.called_from, undefined, body.address, message, body.call_source);

    // Send the request to where it needs to go
    await APICoordinator.contactMade(contact, JSON.stringify(body));
}

module.exports = {
    leadHandle
};
