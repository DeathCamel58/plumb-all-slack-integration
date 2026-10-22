import * as Sentry from "@sentry/node";
import events from "../events.js";
import mailchimp from "@mailchimp/mailchimp_marketing";

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_API_KEY.split("-")[1],
});

async function mailchimpSendEvent(data) {
  const emails = data.client?.emails ?? [];
  const email = (emails.find((e) => e.primary) ?? emails[0])?.address;

  if (!email) {
    console.log(
      `Mailchimp: Client ${data.client?.id} has no email, skipping invoice_made event`,
    );
    return;
  }

  try {
    await mailchimp.lists.createListMemberEvent(
      process.env.MAILCHIMP_LIST_ID,
      email,
      { name: "invoice_made" },
    );
    console.log("Mailchimp: Sent invoice_made event");
  } catch (e) {
    // Mailchimp returns 404 when the email isn't a member of the list
    if (e.status === 404) {
      console.log(
        `Mailchimp: ${email} isn't on the list, skipping invoice_made event`,
      );
      return;
    }
    Sentry.captureException(e, { extra: { clientId: data.client?.id } });
    console.error(
      `Mailchimp: Error sending invoice_made event for ${email}:`,
      e.status ?? "",
      e.response?.body?.detail ?? e.message,
    );
  }
}
events.on("mailchimp-INVOICE_CREATE_UPDATE", mailchimpSendEvent);
