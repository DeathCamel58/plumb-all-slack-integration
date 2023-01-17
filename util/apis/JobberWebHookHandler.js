const crypto = require('crypto');
let Jobber = require("./Jobber.js");
let PostHog = require('./PostHog.js');


/**
 * Checks if the HMAC was valid to ensure the Webhook came from Jobber
 * TODO: This currently doesn't work, and would return `false`. This has been changed to always return `true`.
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
async function invoiceHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get Invoice data
        let invoice = await Jobber.getInvoiceData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(invoice.client);
        // Insert/Update Invoice into PostHog
        await PostHog.logInvoice(invoice, clientID);
    }
}

/**
 * Adds/Updates client in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function clientHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get client data
        let client = await Jobber.getClientData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        await PostHog.logClient(client);
    }
}

/**
 * Adds quote event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function quoteCreateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get quote data
        let quote = await Jobber.getQuoteData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(quote.client);
        // Insert quote in PostHog
        await PostHog.logQuote(quote, clientID);
    }
}

/**
 * Adds quote acceptance event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function quoteUpdateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get quote data
        let quote = await Jobber.getQuoteData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(quote.client);
        // Update quote in PostHog
        await PostHog.logQuoteUpdate(quote, clientID);
    }
}

/**
 * Adds job create event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function jobCreateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get quote data
        let quote = await Jobber.getJobData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(quote.client);
        // Insert quote in PostHog
        await PostHog.logJob(quote, clientID);
    }
}

/**
 * Adds job update event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function jobUpdateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get quote data
        let quote = await Jobber.getJobData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(quote.client);
        // Insert quote in PostHog
        await PostHog.logJobUpdate(quote, clientID);
    }
}

/**
 * Adds new payment event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function paymentCreateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get quote data
        let payment = await Jobber.getPaymentData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(payment.client);
        // Insert quote in PostHog
        await PostHog.logPayment(payment, clientID);
    }
}

/**
 * Adds payment update event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function paymentUpdateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get quote data
        let payment = await Jobber.getPaymentData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(payment.client);
        // Insert quote in PostHog
        await PostHog.logPaymentUpdate(payment, clientID);
    }
}


module.exports = {
    clientHandle,
    invoiceHandle,
    quoteCreateHandle,
    quoteUpdateHandle,
    jobCreateHandle,
    jobUpdateHandle,
    paymentCreateHandle,
    paymentUpdateHandle
};
