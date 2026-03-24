import Contact from "../contact.js";
import * as APICoordinator from "../APICoordinator.js";
import HTMLParser from "node-html-parser";
import * as Sentry from "@sentry/node";
import events from "../events.js";

/**
 * Extracts the company name from a Rentvine subject line.
 * Subject format: "CompanyName assigned you Work Order #NNNNN | address"
 * @param {string} subject
 * @returns {string}
 */
function extractCompanyName(subject) {
  const match = subject?.match(/^(.+?)\s+assigned you Work Order/);
  return match ? match[1].trim() : "Rentvine";
}

/**
 * Extracts the work order number from a Rentvine subject line.
 * @param {string} subject
 * @returns {string}
 */
function extractWorkOrderNumber(subject) {
  const match = subject?.match(/Work Order #(\d+)/);
  return match ? match[1] : "";
}

/**
 * Processes a Rentvine work order assignment email webhook
 * @param data The incoming ProxiedMail webhook data
 * @returns {Promise<void>}
 */
async function workOrderHandle(data) {
  if (process.env.DEBUG === "TRUE") {
    console.log("Rentvine: Data was");
    console.log(data);
  }

  console.log("Rentvine: Received work order assignment email");

  const subject = data.payload?.subject ?? "";

  // Ignore unassignment emails
  if (subject.includes("unassigned you from Work Order")) {
    console.log("Rentvine: Ignoring unassignment email");
    return;
  }

  try {
    const bodyHtml = data.payload?.["body-html"] ?? "";

    const companyName = extractCompanyName(subject);
    const workOrderNumber = extractWorkOrderNumber(subject);

    const email = HTMLParser.parse(bodyHtml);

    // Extract resident info from the residents list
    let residentName = "";
    let residentPhone = "";
    let residentEmail = "";

    const residentLis = email.querySelectorAll("ul li");
    if (residentLis.length > 0) {
      const residentLi = residentLis[0];
      const residentText = residentLi.innerHTML;

      // Name is the first text node before <br>
      const nameMatch = residentText.match(/^\s*([^<]+)/);
      if (nameMatch) {
        residentName = nameMatch[1].trim();
      }

      // Phone: look for a line like (404) 323-9616
      const phoneMatch = residentText.match(
        /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
      );
      if (phoneMatch) {
        residentPhone = phoneMatch[0].trim();
      }

      // Email: look for an email address in the text
      const emailMatch = residentText.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (emailMatch) {
        residentEmail = emailMatch[0].trim();
      }
    }

    // Extract address from the Location div
    let address = "";
    const locationDiv = findDivAfterLabel(email, "Location:");
    if (locationDiv) {
      address = locationDiv
        .replace(/<br\s*\/?>/gi, ", ")
        .replace(/<[^>]*>/g, "")
        .trim();
    }

    // Extract description
    let description = "";
    const descriptionDiv = findDivAfterLabel(email, "Description");
    if (descriptionDiv) {
      description = descriptionDiv
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .trim();
    }

    const message = `Work Order: #${workOrderNumber}\nDescription: ${description}`;

    const contactType = `Rentvine (${companyName})`;
    const source = companyName.toLowerCase().replace(/\s+/g, "-");

    let contact = new Contact(
      contactType,
      residentName || undefined,
      residentPhone || undefined,
      undefined,
      residentEmail || undefined,
      address || undefined,
      message,
      source,
    );

    await APICoordinator.contactMade(contact, JSON.stringify(data));
  } catch (e) {
    Sentry.captureException(e);
    console.error("Rentvine: Error processing work order email:", e);
    console.error("Rentvine: Raw email data:", JSON.stringify(data));
  }
}

/**
 * Finds the content of a div that follows a <b> label in the Rentvine HTML.
 * @param {object} root Parsed HTML root
 * @param {string} label The label text to search for (e.g. "Description")
 * @returns {string|null} The innerHTML of the content div, or null
 */
function findDivAfterLabel(root, label) {
  const bolds = root.querySelectorAll("b");
  for (const b of bolds) {
    if (b.textContent.trim().startsWith(label)) {
      // The content is in the next sibling or in the parent div after the <b><br>
      const parent = b.parentNode;
      if (parent) {
        // Remove the <b> tag content and get the rest
        let html = parent.innerHTML;
        // Remove everything up to and including the </b> and any following <br>
        const idx = html.indexOf("</b>");
        if (idx !== -1) {
          html = html.substring(idx + 4).replace(/^\s*<br\s*\/?>\s*/i, "");
        }
        return html.trim();
      }
    }
  }
  return null;
}

events.on("rentvine-work-order", workOrderHandle);
