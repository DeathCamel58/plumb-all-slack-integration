import Contact from "../contact.js";
import * as APICoordinator from "../APICoordinator.js";
import * as Sentry from "@sentry/node";
import events from "../events.js";

/**
 * 86 Repairs bullets every detail line with `・` (U+30FB).
 *
 * The mail reaches us second hand: 86 Repairs sends it to info@plumb-all.com and
 * an Outlook rule forwards it on. That bullet is the only non-ASCII character in
 * their template, so Outlook decides the mail is Japanese and re-encodes it as
 * ISO-2022-JP on the way out, which can deliver the bullet as a raw charset
 * switch run instead of a character. Strip either form.
 */
const LEADING_BULLET = /^(?:\u001b\$B!&\u001b\(B|[・･•·])\s*/;

/**
 * Renders an HTML email body as plain lines: one per `<br>`, trimmed, with the
 * leading bullet removed and blank lines kept so they can delimit sections.
 * @param bodyHtml The `body-html` from the incoming webhook
 * @returns {string[]} The lines of the email
 */
function htmlToLines(bodyHtml) {
  return (
    (bodyHtml ?? "")
      .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, "")
      // HTML collapses whitespace, so the source line breaks aren't line breaks
      .replace(/\s+/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;/gi, "'")
      // Decoded last, so an escaped entity isn't decoded twice
      .replace(/&amp;/gi, "&")
      .split("\n")
      .map((line) =>
        line.trim().replace(LEADING_BULLET, "").replace(/ {2,}/g, " "),
      )
  );
}

/**
 * Reads a `Label: value` line, e.g. `・ Address: 100 Example Street`.
 * @param lines The lines of the email
 * @param label The label to look for, without its colon
 * @returns {string|undefined} The value, or undefined if the line isn't there
 */
function fieldValue(lines, label) {
  const prefix = `${label}:`;
  const line = lines.find(
    (l) => l.startsWith(prefix) && l.length > prefix.length,
  );

  return line ? line.slice(prefix.length).trim() || undefined : undefined;
}

/**
 * Reads the block under a `Label:` heading, up to the next blank line. 86 Repairs
 * wraps long values over several lines, so this joins them back together.
 * @param lines The lines of the email
 * @param label The heading to look for, without its colon
 * @returns {string|undefined} The value, or undefined if the heading isn't there
 */
function sectionValue(lines, label) {
  const start = lines.indexOf(`${label}:`);
  if (start === -1) {
    return undefined;
  }

  const section = [];
  for (let i = start + 1; i < lines.length && lines[i] !== ""; i += 1) {
    section.push(lines[i]);
  }

  return section.join(" ").trim() || undefined;
}

/**
 * Reads the site the service is needed at. Capitalization of `Service` changes
 * based on the type of email, so match on the tail of the phrase.
 * @param lines The lines of the email
 * @returns {string|undefined} The site name, or undefined if it isn't there
 */
function clientName(lines) {
  const marker = "ervice is needed at:";
  const line = lines.find((l) => l.includes(marker));

  return line
    ? line.slice(line.indexOf(marker) + marker.length).trim() || undefined
    : undefined;
}

/**
 * Reads the number 86 Repairs asks us to call or text about the job.
 * @param lines The lines of the email
 * @returns {string|undefined} The number, or undefined if it isn't there
 */
function contactNumber(lines) {
  return lines.join("\n").match(/call\/text\s+(.+?)\s*\./i)?.[1];
}

/**
 * Reads the body of a follow up email, which sits between the header and the
 * sender's signature rather than in labelled fields.
 * @param lines The lines of the email
 * @returns {string|undefined} The message, or undefined if it isn't there
 */
function followUpMessage(lines) {
  const start = lines.findIndex((l) =>
    l.includes("Email not displaying correctly?"),
  );
  const end = lines.findIndex((l) => l.includes("Customer Service Specialist"));
  if (start === -1 || end === -1) {
    return undefined;
  }

  return (
    lines
      .slice(start + 1, end)
      // Drop the line that says `Thanks` or `Thank you`
      .filter((line) => line !== "" && !line.includes("hank"))
      .join(" ")
      .trim() || undefined
  );
}

/**
 * Turns a parsed 86 Repairs email into a Contact and hands it on.
 * @param data The incoming web data
 * @param lines The lines of the email
 * @param type The type of email this is
 * @returns {Promise<void>}
 */
async function handleMessage(data, lines, type) {
  const site = clientName(lines);
  if (!site) {
    throw new Error(
      "86 Repairs: Could not find `Service is needed at:` in the email body",
    );
  }

  let mainMessagePart = "";

  // Get the parts of the mail that change based on the type of contact
  if (type === "New Service") {
    mainMessagePart = sectionValue(lines, "Reported Issue") ?? "";
  } else if (type === "Quote Approved") {
    const quotedFor = lines
      .join("\n")
      .split("Your quote for ")[1]
      ?.split(" has been approved by")[0];
    mainMessagePart = `Quote Approved for ${quotedFor}`;
  } else if (type === "Follow Up On Service") {
    mainMessagePart = followUpMessage(lines) ?? "";
  } else {
    const error = "86 Repairs: Failed to parse the email";
    Sentry.captureMessage(error);
    console.error(error);
  }

  const messageParts = [{ name: "Type", value: type }];
  const fields = [
    ["Priority", sectionValue(lines, "Priority")],
    ["Warranty Check Info", sectionValue(lines, "Warranty Check Info")],
    ["Location Contact", fieldValue(lines, "Location Contact")],
    ["Customer Name", fieldValue(lines, "Customer Name")],
  ];
  for (const [name, value] of fields) {
    // 86 Repairs adds and drops fields between templates, so skip missing ones
    // rather than putting `undefined` in the message
    if (value) {
      messageParts.push({ name, value });
    }
  }

  let message = mainMessagePart;

  for (const item of messageParts) {
    message += `\n- ${item.name}: ${item.value}`;
  }

  let contact = new Contact(
    "86 Repairs Call",
    site,
    contactNumber(lines),
    undefined,
    undefined,
    fieldValue(lines, "Address"),
    message,
    "86Repairs",
  );

  await APICoordinator.contactMade(contact, JSON.stringify(data));
}

/**
 * Processes an 86 Repairs webhook
 * @param data The incoming ProxiedMail webhook data
 * @returns {Promise<void>}
 * @constructor
 */
async function workOrderHandle(data) {
  if (process.env.DEBUG === "TRUE") {
    console.log("86 Repairs: Data was");
    console.log(data);
  }

  console.log("86 Repairs: Received work order email");

  try {
    // Parsed from `body-html`: ProxiedMail decodes that part, but hands over
    // `body-plain` with Outlook's ISO-2022-JP escapes still in it
    const lines = htmlToLines(data.payload["body-html"]);
    const body = lines.join("\n");

    if (body.includes("Customer Service Specialist")) {
      // Reply to service call
      await handleMessage(data, lines, "Follow Up On Service");
    } else if (body.includes("The service visit is scheduled for:")) {
      // Service visit confirmation
      console.log("86 Repairs: Ignoring service schedule confirmation email");
    } else if (body.includes("has been approved by the customer")) {
      // Quote approval
      // We're ignoring quote approvals per management request
      // await handleMessage(data, lines, "Quote Approved");
    } else if (body.includes("to log in to the 86 Repairs portal")) {
      // One time login code for the 86 Repairs portal
      console.log("86 Repairs: Ignoring portal login code email");
    } else {
      // New service
      await handleMessage(data, lines, "New Service");
    }
  } catch (e) {
    Sentry.captureException(e);
    console.error("86 Repairs: Error processing email:", e);
    console.error("86 Repairs: Raw email data:", JSON.stringify(data));
  }
}

events.on("86repairs-call", workOrderHandle);
