const crypto = require('crypto');
let { getInvoiceData, getClientData } = require("./Jobber.js");
let { logClient, logInvoice } = require('../posthog.js');


/**
 * Checks if the HMAC was valid to ensure the Webhook came from Jobber
 * TODO: This currently doesn't work, and returns `false`.
 * REF: https://developer.getjobber.com/docs/build_with_jobber/webhooks/#webhook-payload
 * @param webhookBody The data that Jobber sent
 * @param jobberHmac The HMAC that Jobber sent
 * @returns {boolean} `true` if the HMAC was valid
 */
function jobberVerify(webhookBody, jobberHmac) {
    let jobberSecret = process.env.JOBBER_APP_SECRET || "";
    let stringData = JSON.stringify(webhookBody.data, null, 2);
    const digest = crypto.createHmac('sha256', jobberSecret).update(stringData).digest('base64');

    let result = crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(jobberHmac));
    return true;
}

async function invoiceWebhookHandle(req) {
    let body = req.body;
    let authentic = jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'));

    // TODO: Ensure the webhook is authentic

    console.log(body.data.webHookEvent.itemId);

    // Get Invoice data
    let invoice = await getInvoiceData(body.data.webHookEvent.itemId);
    // Insert/Update client in PostHog
    let clientID = await logClient(invoice.client);
    // Insert/Update Invoice into PostHog
    await logInvoice(invoice, clientID);
}

async function clientWebhookHandle(req) {
    let body = req.body;
    let authentic = jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'));

    // TODO: Ensure the webhook is authentic

    console.log(body.data.webHookEvent.itemId);

    // Get client data
    let client = await getClientData(body.data.webHookEvent.itemId);
    // Insert/Update client in PostHog
    await logClient(client);
}


module.exports = {
    clientWebhookHandle,
    invoiceWebhookHandle
};
