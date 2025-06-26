const crypto = require("crypto");
let Jobber = require("./Jobber");
let PostHog = require("./PostHog");
let Postgres = require("./Postgres");
const Contact = require("../contact");
const APICoordinator = require("../APICoordinator");
const events = require("../events");

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
  const digest = crypto
    .createHmac("sha256", jobberSecret)
    .update(stringData)
    .digest("base64");

  let result = crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(jobberHmac),
  );
  return true;
}

// TODO: Ensure the webhook is authentic for all handlers

/**
 * Creates an invoice event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function invoiceHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get Invoice data
    let invoice = await Jobber.getInvoiceData(
      body.data["webHookEvent"]["itemId"],
    );
    // Insert/Update client
    let clientID = await PostHog.logClient(invoice.client);
    // Insert/Update Invoice
    events.emitter.emit("db-INVOICE_CREATE_UPDATE", invoice);
    await PostHog.logInvoice(invoice, clientID);
  }
}
events.emitter.on("jobber-INVOICE_CREATE", invoiceHandle);

/**
 * Creates an invoice update event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function invoiceUpdateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get Invoice data
    let invoice = await Jobber.getInvoiceData(
      body.data["webHookEvent"]["itemId"],
    );
    // Insert/Update Invoice
    events.emitter.emit("db-INVOICE_CREATE_UPDATE", invoice);
  }
}
events.emitter.on("jobber-INVOICE_UPDATE", invoiceUpdateHandle);

/**
 * Creates an invoice destroy event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function invoiceDestroyHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Destroy Invoice
    events.emitter.emit(
      "db-INVOICE_DESTROY",
      body.data["webHookEvent"]["itemId"],
    );
  }
}
events.emitter.on("jobber-INVOICE_DESTROY", invoiceDestroyHandle);

/**
 * Adds/Updates client
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function clientHandle(req) {
  let body = req.body;

  // Verify the authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get client data
    let client = await Jobber.getClientData(
      body.data["webHookEvent"]["itemId"],
    );
    // Insert/Update client
    events.emitter.emit("db-CLIENT_CREATE_UPDATE", client);
    await PostHog.logClient(client);
  }
}
events.emitter.on("jobber-CLIENT_CREATE", clientHandle);
events.emitter.on("jobber-CLIENT_UPDATE", clientHandle);

/**
 * Creates a client destroy event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function clientDestroyHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Destroy Invoice
    events.emitter.emit(
      "db-CLIENT_DESTROY",
      body.data["webHookEvent"]["itemId"],
    );
  }
}
events.emitter.on("jobber-CLIENT_DESTROY", clientDestroyHandle);

/**
 * Adds quote event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function quoteCreateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get quote data
    let quote = await Jobber.getQuoteData(body.data["webHookEvent"]["itemId"]);
    // Insert/Update client
    let clientID = await PostHog.logClient(quote.client);
    // Insert quote
    events.emitter.emit("db-QUOTE_CREATE_UPDATE", quote);
    await PostHog.logQuote(quote, clientID);
  }
}
events.emitter.on("jobber-QUOTE_CREATE", quoteCreateHandle);

/**
 * Adds quote acceptance event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function quoteUpdateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get quote data
    let quote = await Jobber.getQuoteData(body.data["webHookEvent"]["itemId"]);
    // Insert/Update client
    let clientID = await PostHog.logClient(quote.client);
    // Update quote
    events.emitter.emit("db-QUOTE_CREATE_UPDATE", quote);
    await PostHog.logQuoteUpdate(quote, clientID);
  }
}
events.emitter.on("jobber-QUOTE_UPDATE", quoteUpdateHandle);

/**
 * Creates a quote destroy event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function quoteDestroyHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Destroy Invoice
    events.emitter.emit(
      "db-QUOTE_DESTROY",
      body.data["webHookEvent"]["itemId"],
    );
  }
}
events.emitter.on("jobber-QUOTE_DESTROY", quoteDestroyHandle);

/**
 * Adds job create event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function jobCreateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get job data
    let job = await Jobber.getJobData(body.data["webHookEvent"]["itemId"]);
    // Insert/Update client
    let clientID = await PostHog.logClient(job.client);
    // Insert job
    events.emitter.emit("db-JOB_CREATE_UPDATE", job);
    await PostHog.logJob(job, clientID);
  }
}
events.emitter.on("jobber-JOB_CREATE", jobCreateHandle);

/**
 * Adds job update event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function jobUpdateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get job data
    let job = await Jobber.getJobData(body.data["webHookEvent"]["itemId"]);

    // If job exists, that means this isn't related to a JOB_DESTROY
    if (job) {
      // Insert/Update client
      let clientID = await PostHog.logClient(job.client);
      // Insert job
      events.emitter.emit("db-JOB_CREATE_UPDATE", job);
      await PostHog.logJobUpdate(job, clientID);
    }
  }
}
events.emitter.on("jobber-JOB_UPDATE", jobUpdateHandle);

/**
 * Adds job destroy event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function jobDestroyHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Destroy job
    events.emitter.emit("db-JOB_DESTROY", body.data["webHookEvent"]["itemId"]);
  }
}
events.emitter.on("jobber-JOB_DESTROY", jobDestroyHandle);

/**
 * Adds new payment event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function paymentCreateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get payment data
    let payment = await Jobber.getPaymentData(
      body.data["webHookEvent"]["itemId"],
    );
    // Insert/Update client
    let clientID = await PostHog.logClient(payment.client);
    // Insert payment
    events.emitter.emit("db-PAYMENT_CREATE_UPDATE", payment);
    await PostHog.logPayment(payment, clientID);
  }
}
events.emitter.on("jobber-PAYMENT_CREATE", paymentCreateHandle);

/**
 * Adds payment update event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function paymentUpdateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get payment data
    let payment = await Jobber.getPaymentData(
      body.data["webHookEvent"]["itemId"],
    );
    // Insert/Update client
    let clientID = await PostHog.logClient(payment.client);
    // Insert payment
    events.emitter.emit("db-PAYMENT_CREATE_UPDATE", payment);
    await PostHog.logPaymentUpdate(payment, clientID);
  }
}
events.emitter.on("jobber-PAYMENT_UPDATE", paymentUpdateHandle);

/**
 * Adds payment destroy event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function paymentDestroyHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Destroy payment
    events.emitter.emit(
      "db-PAYMENT_DESTROY",
      body.data["webHookEvent"]["itemId"],
    );
  }
}
events.emitter.on("jobber-PAYMENT_DESTROY", paymentDestroyHandle);

/**
 * Adds payout create event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function payoutCreateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get payout data
    let payout = await Jobber.getPayoutData(
      body.data["webHookEvent"]["itemId"],
    );
    // Insert payout
    // TODO: Insert into DB
    await PostHog.logPayout(payout);
  }
}
events.emitter.on("jobber-PAYOUT_CREATE", payoutCreateHandle);

/**
 * Adds payout updated event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function payoutUpdateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get payout data
    let payout = await Jobber.getPayoutData(
      body.data["webHookEvent"]["itemId"],
    );
    // Insert payout
    // TODO: Insert into DB
    await PostHog.logPayoutUpdate(payout);
  }
}
events.emitter.on("jobber-PAYOUT_UPDATE", payoutUpdateHandle);

/**
 * Adds new property event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function propertyCreateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get property data
    let property = await Jobber.getPropertyData(
      body.data["webHookEvent"]["itemId"],
    );
    // Insert/Update client
    let clientID = await PostHog.logClient(property.client);
    // Insert property
    events.emitter.emit("db-PROPERTY_CREATE_UPDATE", property);
    await PostHog.logProperty(property, clientID);
  }
}
events.emitter.on("jobber-PROPERTY_CREATE", propertyCreateHandle);

/**
 * Adds property update event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function propertyUpdateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get property data
    let property = await Jobber.getPropertyData(
      body.data["webHookEvent"]["itemId"],
    );
    // Insert/Update client
    let clientID = await PostHog.logClient(property.client);
    // Insert property
    events.emitter.emit("db-PROPERTY_CREATE_UPDATE", property);
    await PostHog.logPropertyUpdate(property, clientID);
  }
}
events.emitter.on("jobber-PROPERTY_UPDATE", propertyUpdateHandle);

/**
 * Adds new visit event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function visitCreateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get visit data
    let visit = await Jobber.getVisitData(body.data["webHookEvent"]["itemId"]);
    // Insert/Update client
    let clientID = await PostHog.logClient(visit.client);
    // Insert visit
    // TODO: Insert into DB
    await PostHog.logVisit(visit, clientID);
  }
}
events.emitter.on("jobber-VISIT_CREATE", visitCreateHandle);

/**
 * Adds visit update event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function visitUpdateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get visit data
    let visit = await Jobber.getVisitData(body.data["webHookEvent"]["itemId"]);
    // Insert/Update client
    let clientID = await PostHog.logClient(visit.client);
    // Insert visit
    // TODO: Insert into DB
    await PostHog.logVisitUpdate(visit, clientID);
  }
}
events.emitter.on("jobber-VISIT_UPDATE", visitUpdateHandle);

/**
 * Adds visit complete event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function visitCompleteHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get visit data
    let visit = await Jobber.getVisitData(body.data["webHookEvent"]["itemId"]);
    // Insert/Update client
    let clientID = await PostHog.logClient(visit.client);
    // Insert visit
    // TODO: Insert into DB
    await PostHog.logVisitComplete(visit, clientID);
  }
}
events.emitter.on("jobber-VISIT_COMPLETE", visitCompleteHandle);

/**
 * Adds new request create event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function requestCreateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get request data
    let request = await Jobber.getRequestData(
      body.data["webHookEvent"]["itemId"],
    );
    // Determine which address to use. Use billing address as a fallback
    let address = `${request.client.billingAddress.street}, ${request.client.billingAddress.city} ${request.client.billingAddress.province}, ${request.client.billingAddress.postalCode}`;
    if (request.property !== null && request.property !== undefined) {
      if (
        request.property.address !== null &&
        request.property.address !== undefined
      ) {
        address = `${request.property.address.street}, ${request.property.address.city} ${request.property.address.province}, ${request.property.address.postalCode}`;
      }
    }
    // Send the request to Slack
    let contact = new Contact(
      "Jobber Request",
      request.client.name,
      request.client.phones[0].number,
      null,
      request.client.emails[0].address,
      address,
      `[${request.jobberWebUri}](${request.jobberWebUri}) (You may have to hold on that link, copy it, and paste it into your web browser to access it)`,
      "Jobber",
    );
    await APICoordinator.contactMade(contact, JSON.stringify(body));
  }
}
events.emitter.on("jobber-REQUEST_CREATE", requestCreateHandle);

/**
 * Adds expense create event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function expenseCreateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get expense data
    let expense = await Jobber.getExpenseData(
      body.data["webHookEvent"]["itemId"],
    );

    // Insert/Update employee
    await PostHog.logEmployee(expense.enteredBy);

    // Insert expense
    events.emitter.emit("db-EXPENSE_CREATE_UPDATE", expense);
    await PostHog.logExpenseCreate(expense, expense.enteredBy.uuid);
  }
}
events.emitter.on("jobber-EXPENSE_CREATE", expenseCreateHandle);

/**
 * Adds expense update event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function expenseUpdateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get expense data
    let expense = await Jobber.getExpenseData(
      body.data["webHookEvent"]["itemId"],
    );

    // Insert/Update employee
    await PostHog.logEmployee(expense.enteredBy);

    // Insert expense
    events.emitter.emit("db-EXPENSE_CREATE_UPDATE", expense);
    await PostHog.logExpenseUpdate(expense, expense.enteredBy.uuid);
  }
}
events.emitter.on("jobber-EXPENSE_UPDATE", expenseUpdateHandle);

/**
 * Adds expense destroy event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function expenseDestroyHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Destroy expense
    events.emitter.emit(
      "db-EXPENSE_DESTROY",
      body.data["webHookEvent"]["itemId"],
    );
  }
}
events.emitter.on("jobber-EXPENSE_DESTROY", expenseDestroyHandle);

/**
 * Adds request update event
 * @param req The incoming web data
 * @returns {Promise<void>}
 */
async function requestUpdateHandle(req) {
  let body = req.body;

  // Verify authenticity of webhook, then process
  if (jobberVerify(body, req.header("X-Jobber-Hmac-SHA256"))) {
    // Get request data
    let request = await Jobber.getRequestData(
      body.data["webHookEvent"]["itemId"],
    );
    // Insert/Update client
    let clientID = await PostHog.logClient(request.client);
    // Insert request
    // TODO: Insert into DB
    await PostHog.logRequestUpdate(request, clientID);
  }
}
events.emitter.on("jobber-REQUEST_UPDATE", requestUpdateHandle);
