const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");
const events = require("../events");
const Sentry = require("@sentry/node");

async function handleMessage(data, type) {
  const messageParts = [];

  // Capitalization of `Service` changes based on type, so drop the `S`
  const clientName = data.payload["body-plain"]
    .split("ervice is needed at: ")[1]
    .split("\r\n")[0];
  const clientAddress = data.payload["body-plain"]
    .split("・ Address: ")[1]
    .split("\r\n")[0];

  let mainMessagePart = "";
  let contactNumber = undefined;

  // Get the parts of the mail that change based on the type of contact
  if (type === "New Service") {
    // NOTE: This is only going to get the first bullet point (unsure if there is ever multiple). Looked back and didn't
    // see any
    mainMessagePart = data.payload["body-plain"]
      .split("Reported Issue:\r\n・ ")[1]
      .split("\r\n")[0];
    contactNumber = data.payload["body-plain"]
      .split("call/text ")[1]
      .split(".\r\n")[0];
  } else if (type === "Quote Approved") {
    mainMessagePart = `Quote Approved for ${data.payload["body-plain"].split("Your quote for ")[1].split(" has been approved by")[0]}`;
    contactNumber = data.payload["body-plain"]
      .split("call/text ")[1]
      .split(".\r\n")[0];
  } else if (type === "Follow Up On Service") {
    const messageLines = data.payload["body-plain"]
      .split("Email not displaying correctly?")[1]
      .split("Customer Service Specialist")[0]
      .split("\r\n")
      .slice(2, -5);
    for (const line of messageLines) {
      // Drop the line that says `Thanks` or `Thank you`
      if (!line.includes("hank")) {
        mainMessagePart += line;
        mainMessagePart += " ";
      }
    }
    contactNumber = data.payload["body-plain"]
      .split("Call/Text ")[1]
      .split("\r\n")[0];
  } else {
    const error = "86 Repairs: Failed to parse the email";
    Sentry.captureMessage(error);
    console.error(error);
  }

  messageParts.push({ name: "Type", value: type });
  messageParts.push({
    name: "Priority",
    value: data.payload["body-plain"]
      .split("Priority:\r\n・ ")[1]
      .split("\r\n")[0],
  });
  messageParts.push({
    name: "Warranty Check Info",
    value: data.payload["body-plain"]
      .split("Warranty Check Info:\r\n")[1]
      .split("\r\n")[0],
  });
  messageParts.push({
    name: "Location Contact",
    value: data.payload["body-plain"]
      .split("・ Location Contact: ")[1]
      .split("\r\n")[0],
  });
  messageParts.push({
    name: "Customer Name",
    value: data.payload["body-plain"]
      .split("・ Customer Name: ")[1]
      .split("\r\n")[0],
  });

  let message = mainMessagePart;

  for (const item of messageParts) {
    message += `\n- ${item.name}: ${item.value}`;
  }

  let contact = new Contact(
    "86 Repairs Call",
    clientName,
    contactNumber,
    undefined,
    undefined,
    clientAddress,
    message,
    "86Repairs",
  );

  await APICoordinator.contactMade(contact, JSON.stringify(data));
}

/**
 * Processes an 86 Repairs webhook
 * @param data The incoming web data
 * @returns {Promise<void>}
 * @constructor
 */
async function AlertHandle(data) {
  if (process.env.DEBUG === "TRUE") {
    console.log("86 Repairs: Data was");
    console.log(data);
  }

  if (data.payload["body-plain"].includes("Customer Service Specialist")) {
    // Reply to service call
    await handleMessage(data, "Follow Up On Service");
  } else if (
    data.payload["body-plain"].includes("The service visit is scheduled for:")
  ) {
    // Service visit confirmation
    console.log("86 Repairs: Ignoring service schedule confirmation email");
  } else if (
    data.payload["body-plain"].includes("has been approved by the customer")
  ) {
    // Quote approval
    // We're ignoring quote approvals per management request
    // await handleMessage(data, "Quote Approved");
  } else {
    // New service
    await handleMessage(data, "New Service");
  }
}

events.emitter.on("86repairs-call", AlertHandle);
