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
  if (process.env.DEBUG === "TRUE") {
    console.log("Data was");
    console.log(data);
  }

  const email = HTMLParser.parse(data.payload["body-html"]);

  const storeNumber = email
    .querySelector("table > tbody > tr:nth-child(12) > td:nth-child(3) > span")
    .textContent.split(" - ")[0]
    .split(", ")[1]
    .replaceAll("<b>", "");
  const storeAddress = email
    .querySelector("table > tbody > tr:nth-child(12) > td:nth-child(3)")
    .toString()
    .split("\r\n")
    .slice(1, 3)
    .toString()
    .replaceAll("<br>,", ", ")
    .replace("<br>", "");
  const woNumber = email.querySelector(".WOID").textContent.replace(" ", "");

  const problemDescription = email
    .querySelector("table > tbody > tr:nth-child(15) > td")
    .textContent.split("\n\r\n");

  let woType = "";
  let problemType = "";
  let callDescription = "";

  for (const line of problemDescription) {
    if (line.includes("Work Order Type")) {
      woType = line.split(": ")[1];
    } else if (line.includes("Problem Type")) {
      problemType = line.split(": ")[1];
    } else if (line.includes("Call Description")) {
      callDescription = line.split(": ")[1];
    }
  }

  const message = `Work Order: ${woNumber}\nWork Order Type: ${woType}\nProblem Type: ${problemType}\nCall Description: ${callDescription}`;

  let contact = new Contact(
    "Ingles Call",
    `Ingles ${storeNumber}`,
    undefined,
    undefined,
    undefined,
    storeAddress,
    message,
    "ingles",
  );

  await APICoordinator.contactMade(contact, JSON.stringify(data));
}
events.emitter.on("verisae-ingles", AlertHandle);
