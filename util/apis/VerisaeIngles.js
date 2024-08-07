const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");
const HTMLParser = require("node-html-parser");
const events = require("../events");

/**
 * Processes a Verisae Ingles webhook
 * @param data The incoming web data
 * @returns {Promise<void>}
 * @constructor
 */
async function AlertHandle(data) {
    console.log("Data was");
    console.log(data);

    const email = HTMLParser.parse(data.payload['body-html']);

    const storeNumber = email.querySelector("body > table > tbody > tr:nth-child(12) > td:nth-child(3) > div > span:nth-child(1) > b").toString().split(" - ")[0].replaceAll("<b>", "");
    const storeAddress = email.querySelector("body > table > tbody > tr:nth-child(12) > td:nth-child(3) > div > span:nth-child(2)").textContent.split("Phone: ")[0].replaceAll("\n\r\n", " ").substr(1)
    const woNumber = email.querySelector("body > table > tbody > tr:nth-child(1) > td:nth-child(3) > table > tbody > tr:nth-child(2) > td > div > b").textContent;

    const problemDescription = email.querySelector("body > table > tbody > tr:nth-child(15) > td > div").textContent;

    const woType = problemDescription.split(" ")[1].split("\n")[0];
    const problemType = problemDescription.split("Problem Type: ")[1].split("\n")[0];
    const callDescription = problemDescription.split("Call Description: ")[1].split("\n")[0];

    const message = `Work Order: ${woNumber}\nWork Order Type: ${woType}\nProblem Type: ${problemType}\nCall Description: ${callDescription}`;

    let contact = new Contact("Ingles Call", storeNumber, undefined, undefined, undefined, storeAddress, message, "ingles");

    await APICoordinator.contactMade(contact, JSON.stringify(data));
}
events.emitter.on('verisae-ingles', AlertHandle);
