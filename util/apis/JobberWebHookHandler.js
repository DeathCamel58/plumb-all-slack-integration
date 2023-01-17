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
        // Get job data
        let job = await Jobber.getJobData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(job.client);
        // Insert job in PostHog
        await PostHog.logJob(job, clientID);
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
        // Get job data
        let job = await Jobber.getJobData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(job.client);
        // Insert job in PostHog
        await PostHog.logJobUpdate(job, clientID);
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
        // Get payment data
        let payment = await Jobber.getPaymentData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(payment.client);
        // Insert payment in PostHog
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
        // Get payment data
        let payment = await Jobber.getPaymentData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(payment.client);
        // Insert payment in PostHog
        await PostHog.logPaymentUpdate(payment, clientID);
    }
}

/**
 * Adds payout create event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function payoutCreateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get payout data
        let payout = await Jobber.getPayoutData(body.data["webHookEvent"]["itemId"]);
        // Insert payout in PostHog
        await PostHog.logPayout(payout);
    }
}

/**
 * Adds payout updated event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function payoutUpdateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get payout data
        let payout = await Jobber.getPayoutData(body.data["webHookEvent"]["itemId"]);
        // Insert payout in PostHog
        await PostHog.logPayoutUpdate(payout);
    }
}

/**
 * Adds new property event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function propertyCreateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get property data
        let property = await Jobber.getPropertyData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(property.client);
        // Insert property in PostHog
        await PostHog.logProperty(property, clientID);
    }
}

/**
 * Adds property update event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function propertyUpdateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get property data
        let property = await Jobber.getPropertyData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(property.client);
        // Insert property in PostHog
        await PostHog.logPropertyUpdate(property, clientID);
    }
}

/**
 * Adds new visit event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function visitCreateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get visit data
        let visit = await Jobber.getVisitData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(visit.client);
        // Insert visit in PostHog
        await PostHog.logVisit(visit, clientID);
    }
}

/**
 * Adds visit update event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function visitUpdateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get visit data
        let visit = await Jobber.getVisitData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(visit.client);
        // Insert visit in PostHog
        await PostHog.logVisitUpdate(visit, clientID);
    }
}

/**
 * Adds visit complete event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function visitCompleteHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get visit data
        let visit = await Jobber.getVisitData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(visit.client);
        // Insert visit in PostHog
        await PostHog.logVisitComplete(visit, clientID);
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
    paymentUpdateHandle,
    payoutCreateHandle,
    payoutUpdateHandle,
    propertyCreateHandle,
    propertyUpdateHandle,
    visitCreateHandle,
    visitUpdateHandle,
    visitCompleteHandle
};
