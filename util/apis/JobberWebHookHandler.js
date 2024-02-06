const crypto = require('crypto');
let Jobber = require("./Jobber");
let PostHog = require('./PostHog');
const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");
const events = require('../events');


/**
 * Checks if the HMAC was valid to ensure the Webhook came from Jobber
 * TODO: This currently doesn't work, and would return `false`. This has been changed to always return `true`.
 * REF: https://developer.getjobber.com/docs/build_with_jobber/webhooks/#webhook-payload
 * @param webhookBody The data that Jobber sent
 * @param jobberHmac The HMAC that Jobber sent
 * @returns {boolean} `true` if the HMAC was valid
 */
function jobberVerify(webhookBody, jobberHmac) {
    if (process.env.DEBUG === "TRUE") {
        return true;
    }

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
events.emitter.on('jobber-INVOICE_CREATE', invoiceHandle);

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
events.emitter.on('jobber-CLIENT_CREATE', clientHandle);
events.emitter.on('jobber-CLIENT_UPDATE', clientHandle);

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
events.emitter.on('jobber-QUOTE_CREATE', quoteCreateHandle);

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
events.emitter.on('jobber-QUOTE_UPDATE', quoteUpdateHandle);

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
events.emitter.on('jobber-JOB_CREATE', jobCreateHandle);

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
events.emitter.on('jobber-JOB_UPDATE', jobUpdateHandle);

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
events.emitter.on('jobber-PAYMENT_CREATE', paymentCreateHandle);

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
events.emitter.on('jobber-PAYMENT_UPDATE', paymentUpdateHandle);

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
events.emitter.on('jobber-PAYOUT_CREATE', payoutCreateHandle);

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
events.emitter.on('jobber-PAYOUT_UPDATE', payoutUpdateHandle);

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
events.emitter.on('jobber-PROPERTY_CREATE', propertyCreateHandle);

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
events.emitter.on('jobber-PROPERTY_UPDATE', propertyUpdateHandle);

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
events.emitter.on('jobber-VISIT_CREATE', visitCreateHandle);

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
events.emitter.on('jobber-VISIT_UPDATE', visitUpdateHandle);

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
events.emitter.on('jobber-VISIT_COMPLETE', visitCompleteHandle);

/**
 * Adds new request create event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function requestCreateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get request data
        let request = await Jobber.getRequestData(body.data["webHookEvent"]["itemId"]);
        // Determine which address to use. Use billing address as a fallback
        let address = `${request.client.billingAddress.street}, ${request.client.billingAddress.city} ${request.client.billingAddress.province}, ${request.client.billingAddress.postalCode}`;
        if (request.property !== null && request.property !== undefined) {
            if (request.property.address !== null && request.property.address !== undefined) {
                address = `${request.property.address.street}, ${request.property.address.city} ${request.property.address.province}, ${request.property.address.postalCode}`;
            }
        }
        // Send the request to Slack
        let contact = new Contact("Jobber Request", request.client.name, request.client.phones[0].number, null, request.client.emails[0].address, address, `<${request.jobberWebUri}|Details in Jobber> (You may have to hold on that link, copy it, and paste it into your web browser to access it)`, "Jobber");
        await APICoordinator.contactMade(contact, JSON.stringify(body));
    }
}
events.emitter.on('jobber-REQUEST_CREATE', requestCreateHandle);

/**
 * Adds expense create event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function expenseCreateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get expense data
        let expense = await Jobber.getExpenseData(body.data["webHookEvent"]["itemId"]);

        // Insert/Update employee in PostHog
        await PostHog.logEmployee(expense.enteredBy);

        // Insert visit in PostHog
        await PostHog.logExpenseCreate(expense, expense.enteredBy.uuid);
    }
}
events.emitter.on('jobber-EXPENSE_CREATE', expenseCreateHandle);

/**
 * Adds expense update event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function expenseUpdateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get expense data
        let expense = await Jobber.getExpenseData(body.data["webHookEvent"]["itemId"]);

        // Insert/Update employee in PostHog
        await PostHog.logEmployee(expense.enteredBy);

        // Insert visit in PostHog
        await PostHog.logExpenseUpdate(expense, expense.enteredBy.uuid);
    }
}
events.emitter.on('jobber-EXPENSE_UPDATE', expenseUpdateHandle);

/**
 * Adds request update event in PostHog
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function requestUpdateHandle(req) {
    let body = req.body;

    // Verify authenticity of webhook, then process
    if (jobberVerify(body, req.header('X-Jobber-Hmac-SHA256'))) {
        // Get request data
        let request = await Jobber.getRequestData(body.data["webHookEvent"]["itemId"]);
        // Insert/Update client in PostHog
        let clientID = await PostHog.logClient(request.client);
        // Insert request in PostHog
        await PostHog.logRequestUpdate(request, clientID);
    }
}
events.emitter.on('jobber-REQUEST_UPDATE', requestUpdateHandle);
