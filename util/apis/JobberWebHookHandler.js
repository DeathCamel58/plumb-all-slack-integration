const crypto = require('crypto');
let { getInvoiceData, getQuoteData, getClientData, getPaymentData } = require("./Jobber.js");
let {
    logClient,
    logInvoice,
    logQuote,
    logQuoteUpdate,
    logJob,
    logPayment
} = require('../posthog.js');
const {getJobData} = require("./Jobber");


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

// TODO: Ensure the webhook is authentic for all handlers

/**
 * Creates an invoice event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function invoiceWebhookHandle(req) {
    let body = req.body;
    let authentic = jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'));

    // Get Invoice data
    let invoice = await getInvoiceData(body.data.webHookEvent.itemId);
    // Insert/Update client in PostHog
    let clientID = await logClient(invoice.client);
    // Insert/Update Invoice into PostHog
    await logInvoice(invoice, clientID);
}

/**
 * Adds/Updates client in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function clientWebhookHandle(req) {
    let body = req.body;
    let authentic = jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'));

    // Get client data
    let client = await getClientData(body.data.webHookEvent.itemId);
    // Insert/Update client in PostHog
    await logClient(client);
}

/**
 * Adds quote event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function quoteCreateWebhookHandle(req) {
    let body = req.body;
    let authentic = jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'));

    // Get quote data
    let quote = await getQuoteData(body.data.webHookEvent.itemId);
    // Insert/Update client in PostHog
    let clientID = await logClient(quote.client);
    // Insert quote in PostHog
    await logQuote(quote, clientID);
}

/**
 * Adds quote acceptance event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function quoteUpdateWebhookHandle(req) {
    let body = req.body;
    let authentic = jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'));

    // Get quote data
    let quote = await getQuoteData(body.data.webHookEvent.itemId);
    // Insert/Update client in PostHog
    let clientID = await logClient(quote.client);
    // Update quote in PostHog
    await logQuoteUpdate(quote, clientID);
}

/**
 * Adds job event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function jobCreateWebhookHandle(req) {
    let body = req.body;
    let authentic = jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'));

    // Get quote data
    let quote = await getJobData(body.data.webHookEvent.itemId);
    // Insert/Update client in PostHog
    let clientID = await logClient(quote.client);
    // Insert quote in PostHog
    await logJob(quote, clientID);
}

/**
 * Adds payment event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function paymentCreateWebhookHandle(req) {
    let body = req.body;
    let authentic = jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'));

    // Get quote data
    let payment = await getPaymentData(body.data.webHookEvent.itemId);
    // Insert/Update client in PostHog
    let clientID = await logClient(payment.client);
    // Insert quote in PostHog
    await logPayment(payment, clientID);
}


module.exports = {
    clientWebhookHandle,
    invoiceWebhookHandle,
    quoteCreateWebhookHandle,
    quoteUpdateWebhookHandle,
    jobCreateWebhookHandle,
    paymentCreateWebhookHandle
};
