import * as Jobber from "./Jobber.js";
import events from "../events.js";
import mailchimp from "@mailchimp/mailchimp_marketing";

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_API_KEY.split("-")[1],
});

async function mailchimpSendEvent(data) {
  const client = await Jobber.getClientData(data.client.id);

  let email;
  for (let i = 0; i < data.client.emails.length; i++) {
    if (data.client.emails[i]["primary"]) {
      email = data.client.emails[i].address;
    }
  }

  try {
    const response = await mailchimp.lists.createListMemberEvent(
      process.env.MAILCHIMP_LIST_ID,
      email,
      { name: "invoice_made" },
    );
    console.log("Mailchimp: Sent invoice_made event");
  } catch (e) {
    console.error(e, `email: ${email}`, `client: ${JSON.stringify(client)}`);
  }
}
events.on("mailchimp-INVOICE_CREATE_UPDATE", mailchimpSendEvent);
