const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");
const events = require('../events');

/**
 * Processes a Verisae Ingles webhook
 * @param data The incoming web data
 * @returns {Promise<void>}
 * @constructor
 */
async function AlertHandle(data) {
    console.log("Data was");
    console.log(data);

    const email = data.payload;

    const storeNumber = email['body-html'].split("<b>Subject:</b> ")[1].split(" - ")[0];
    const storeAddress = email['body-html'].split("<td width=\"325px\" rowspan=\"2\" class=\"x_Text2\">")[1].split("</span><br>\r\n")[1].split("<br>\r\nPhone:")[0].replace("<br>\r\n", ", ");
    const woNumber = email['body-html'].split("<td class=\"x_WOID\">")[1].split(" ")[0];
    const woType = email['body-html'].split("<b>Work Order Type:</b> ")[1].split("<br>")[0];
    const problemType = email['body-html'].split("<b>Problem Type:</b> ")[1].split("<br>")[0];
    const callDescription = email['body-html'].split("<b>Call Description:</b><span class=\"x_boldText\"> ")[1].split("</span><br>")[0];

    const message = `Work Order: ${woNumber}\nWork Order Type: ${woType}\nProblem Type: ${problemType}\nCall Description: ${callDescription}`;

    let contact = new Contact("Ingles Call", storeNumber, undefined, undefined, undefined, storeAddress, message, "ingles");

    await APICoordinator.contactMade(contact, JSON.stringify(data));
}
events.emitter.on('verisae-ingles', AlertHandle);
