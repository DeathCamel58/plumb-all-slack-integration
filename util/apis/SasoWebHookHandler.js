const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");

/**
 * Takes in a lead from SASO,
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function leadHandle(req) {
    let body = req.body;

    console.log("Data was");
    console.log(req.body);

    let contact = new Contact("Call", `${body.first_name} ${body.last_name}`, body.phone_number, undefined, undefined, body.address, body.message, body.call_source);

    // Send the request to where it needs to go
    await APICoordinator.contactMade(contact, JSON.stringify(body));
}

module.exports = {
    leadHandle
};
