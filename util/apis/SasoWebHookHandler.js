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

    let contact = new Contact("Call", `${req.body.first_name} ${req.body.last_name}`, req.body.phone_number, undefined, undefined, req.body.address, req.body.message);

    // Send the request to where it needs to go
    await APICoordinator.contactMade(contact, JSON.stringify(body));
}

module.exports = {
    leadHandle
};
