require('dotenv').config({path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env'});
const fetch = require('node-fetch');
const crypto = require("crypto");
const fs = require("fs");
const events = require('../events');


const JOBBER_BASE_URL = "https://api.getjobber.com/api/graphql";
let JOBBER_ACCESS_TOKEN;

/**
 * Sleeps for a period of time
 * @param ms The number of milliseconds to do nothing for.
 * @returns {Promise<unknown>}
 */
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Saves the new refresh token to file
 * @param refresh_token The new refresh token
 */
function saveNewToken(refresh_token) {
    // Save the refresh token to file
    let file = process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env';
    fs.readFile(file, 'utf8', function (err, data) {
        if (err) {
            return console.error(err);
        }

        let result = data.replace(process.env.JOBBER_REFRESH_TOKEN, refresh_token);
        process.env.JOBBER_REFRESH_TOKEN = refresh_token;

        fs.writeFile(file, result, 'utf8', function (err) {
            if (err) {
                console.error('Failed to save the Jobber Refresh Token to file.');
                console.error(err);
            } else {
                console.info('Received new Jobber Refresh Token!');
            }
        });
    });
}

/**
 * Takes in a Jobber webhook request, and checks if it's authentic
 * @param req The request
 * @returns {boolean} Is the webhook authentic?
 */
function verifyWebhook(req) {
    if (process.env.DEBUG === "TRUE") {
        return true;
    }

    // Ensure Slack's signature headers exist
    if ("x-jobber-hmac-sha256" in req.headers) {
        // Get the signature
        let jobberSignature = req.headers['x-jobber-hmac-sha256'];
        let body = req.body;

        let mySignature = crypto
            .createHmac('sha256', process.env.JOBBER_APP_SECRET)
            .update(body, 'utf8')
            .digest('base64');

        if (crypto.timingSafeEqual(Buffer.from(mySignature, 'utf8'), Buffer.from(jobberSignature, 'utf8'))) {
            return true;
        } else {
            console.warn(`Jobber webhook signature invalid.\n\tExpecting: ${mySignature}\n\tReceived: ${jobberSignature}`);
        }
    }

    // This is not signed properly
    return false;
}

/**
 * Sets the JOBBER_AUTHORIZATION_CODE
 * @param code The new authorization code
 */
async function setAuthorization(code) {
    process.env.JOBBER_AUTHORIZATION_CODE = code;
    let success = false;
    while (!success) {
        try {
            let response = await fetch(`https://api.getjobber.com/api/oauth/token?client_id=${process.env.JOBBER_CLIENT_ID}&client_secret=${process.env.JOBBER_APP_SECRET}&grant_type=authorization_code&code=${process.env.JOBBER_AUTHORIZATION_CODE}`, {
                method: 'post'
            });

            if (response.status === 200) {
                success = true;
                let data = await response.text();
                data = JSON.parse(data);
                JOBBER_ACCESS_TOKEN = data.access_token;

                saveNewToken(data.refresh_token);
            }
            if (response.status === 401) {
                console.error(`Got ${response.status} while refreshing access token. Requesting authorization!`);
                await requestAuthorization();
            }
        } catch (e) {
            console.error(`Fetch: Failure in setAuthorization`);
            console.error(e);
        }
    }
}

function waitForEvent(eventName, emitter) {
    return new Promise(resolve => {
        emitter.once(eventName, data => {
            resolve(data);
        });
    });
}

let waitingForAuthorization = false;

/**
 * Sends a message to slack that the user can click on to get authorization
 * @returns {Promise<void>}
 */
async function requestAuthorization() {
    if (!waitingForAuthorization) {
        const SlackBot = require("./SlackBot");
        let redirect_URI = `${process.env.WEB_URL}/jobber/authorize`;
        redirect_URI = encodeURIComponent(redirect_URI);
        let STATE = crypto.randomBytes(16).toString('hex');
        let message = `Error from the call bot. *Super technical error code*: :robot_face::frowning::thumbsdown:\nI\'ve lost my access to Jobber and I need some help.\nI need an admin in Jobber to click on --><https://api.getjobber.com/api/oauth/authorize?client_id=${process.env.JOBBER_CLIENT_ID}&redirect_uri=${redirect_URI}&state=${STATE}|this link><-- and click \`ALLOW ACCESS\`.`;
        events.emitter.emit('slackbot-send-message', message, 'Call Bot Jobber Authorization');
        console.info('Sent Jobber authorization request to Slack!');

        waitingForAuthorization = true;
    }

    // Wait for the event that's fired when the authorization is updated
    await waitForEvent('jobber-AUTHORIZATION', events.emitter);

    console.log("Got the authorization!");
    waitingForAuthorization = false;
}

/**
 * Updates the access token when it's found to be invalid.
 * @returns {Promise<void>}
 */
async function refreshAccessToken() {
    let success = false;
    let data;
    while (!success) {
        try {
            let response = await fetch(`https://api.getjobber.com/api/oauth/token`, {
                method: 'post',
                headers: {
                    "content-type": "application/x-www-form-urlencoded"
                },
                body: `client_id=${process.env.JOBBER_CLIENT_ID}&client_secret=${process.env.JOBBER_APP_SECRET}&grant_type=refresh_token&refresh_token=${process.env.JOBBER_REFRESH_TOKEN}`
            });

            switch (response.status) {
                case 200:
                    success = true;
                    data = await response.text();
                    data = JSON.parse(data);
                    JOBBER_ACCESS_TOKEN = data.access_token;

                    saveNewToken(data.refresh_token);
                    break;
                case 429:
                    console.error(`Got 429 while refreshing access token. This is likely because of some sort of limiting!`);
                    break;
                case 401:
                default:
                    console.error(`Got ${response.status} while refreshing access token. Requesting authorization!`);
                    await requestAuthorization();
                    break;
            }
        } catch (e) {
            console.error(`Fetch: Failure in refreshAccessToken`);
            console.error(e);
        }
    }
}

/**
 * Fires a graphql request
 * @param query The query to make
 * @returns {Promise<*>} The GraphQL query data
 */
async function makeRequest(query) {
    let success = false;
    let response;
    while (!success) {
        try {
            response = await fetch(JOBBER_BASE_URL, {
                method: 'post',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${JOBBER_ACCESS_TOKEN}`,
                    'X-JOBBER-GRAPHQL-VERSION': '2022-12-07'
                },
                body: `{"query":${JSON.stringify(query)}}`
            });

            switch (response.status) {
                // HTTP: OK
                case 200:
                    success = true;
                    break;
                // HTTP: Unauthorized
                case 401:
                    console.error(`Got ${response.status} from the Jobber API. Refreshing access token and trying again!`);
                    await refreshAccessToken();
                    break;
                // HTTP: All Others
                default:
                    console.error(`Got ${response.status} while running query. Body follows.`);
                    let text = await response.text();
                    console.error(text);
                    break;
            }
        } catch (e) {
            console.error(`Fetch: Failure in makeRequest`);
            console.error(e);
        }
    }

    let data = await response.text();
    data = JSON.parse(data);

    return data.data;
}

/**
 * Runs Jobber Invoice query for given itemID, and returns the data
 * @param itemID The itemID in the webhook
 * @returns {Promise<*>} The data for the invoice
 */
async function getInvoiceData(itemID) {
    let query =
        `
query InvoiceQuery {
    invoice (id: "${itemID}") {
        client {
            id
        }
        subject
        invoiceNumber
        amounts {
            depositAmount
            discountAmount
            invoiceBalance
            paymentsTotal
            subtotal
            tipsTotal
            total
        }
        createdAt
        jobberWebUri
    }
}
        `;

    let invoiceResponse = await makeRequest(query);

    invoiceResponse["invoice"].client = await getClientData(invoiceResponse["invoice"].client.id);

    return invoiceResponse["invoice"];
}

/**
 * Runs Jobber Invoice query and returns the data
 * @param filterValue The invoice number to filter by
 * @returns {Promise<*>} The data for the invoice
 */
async function getInvoiceSearchData(filterValue) {
    let query =
        `
query InvoiceQuery {
  invoices (searchTerm: "${filterValue}", first: 1) {
    nodes {
      id
      invoiceNumber
    }
  }
}
        `;

    let invoiceResponse = await makeRequest(query);

    if (invoiceResponse != undefined && invoiceResponse.invoices.nodes.length > 0 && invoiceResponse.invoices.nodes[0].invoiceNumber.toString() === filterValue.toString()) {
        invoiceResponse = await getInvoiceData(invoiceResponse.invoices.nodes[0].id);
    } else {
        return null
    }

    return invoiceResponse;
}

/**
 * Runs Jobber Quote query for given itemID, and returns the data
 * @param itemID The itemID in the webhook
 * @returns {Promise<*>} The data for the quote
 */
async function getQuoteData(itemID) {
    let query =
        `
query QuoteQuery {
    quote (id: "${itemID}") {
        client {
            id
        }
        jobberWebUri
        quoteNumber
        quoteStatus
        title
        amounts {
          depositAmount
          discountAmount
          nonTaxAmount
          outstandingDepositAmount
          subtotal
          taxAmount
          total
        }
        createdAt
    }
}
        `;

    let quoteResponse = await makeRequest(query);

    quoteResponse["quote"].client = await getClientData(quoteResponse["quote"].client.id);

    return quoteResponse["quote"];
}

/**
 * Runs Jobber Quote query and returns the data
 * @param filterType The filter attribute name
 * @param filterValue The filter attribute value
 * @returns {Promise<*>} The data for the quote
 */
async function getQuoteSearchData(filterType, filterValue) {
    let query =
        `
query QuoteQuery {
  quotes (filter: {${filterType}: {eq: ${filterValue}}}, first: 1) {
    nodes {
      id
    }
  }
}
        `;

    let quoteResponse = await makeRequest(query);

    if (quoteResponse.quotes.nodes.length > 0) {
        quoteResponse = await getQuoteData(quoteResponse.quotes.nodes[0].id);
    } else {
        return null
    }

    return quoteResponse;
}

/**
 * Runs Jobber job query for given itemID, and returns the data
 * @param itemID The itemID in the webhook
 * @returns {Promise<*>} The data for the job
 */
async function getJobData(itemID) {
    let query =
        `
query JobQuery {
    job (id: "${itemID}") {
        client {
            id
        }
        jobberWebUri
        jobNumber
        jobStatus
        title
        total
        createdAt
    }
}
        `;

    let jobResponse = await makeRequest(query);

    jobResponse["job"].client = await getClientData(jobResponse["job"].client.id);

    return jobResponse["job"];
}

/**
 * Runs Jobber Job query and returns the data
 * @param filterValue The job number to filter by
 * @returns {Promise<*>} The data for the job
 */
async function getJobSearchData(filterValue) {
    let query =
        `
query JobQuery {
  jobs (searchTerm: "${filterValue}", first: 1) {
    nodes {
      id
      jobNumber
    }
  }
}
        `;

    let jobResponse = await makeRequest(query);

    if (jobResponse != undefined && jobResponse.jobs.nodes.length > 0 && jobResponse.jobs.nodes[0].jobNumber.toString() === filterValue.toString()) {
        jobResponse = await getJobData(jobResponse.jobs.nodes[0].id);
    } else {
        return null
    }

    return jobResponse;
}

/**
 * Runs Jobber Client query for given itemID, and returns the data
 * @param itemID The itemID in the webhook
 * @returns {Promise<*>} The data for the client
 */
async function getClientData(itemID) {
    let query =
        `
query ClientQuery {
  client (id: "${itemID}") {
    name
    companyName
    defaultEmails
    phones {
      number
      primary
    }
    emails {
      address
      primary
    }
    firstName
    lastName
    isCompany
    jobberWebUri
    secondaryName
    title
    billingAddress {
      street
      city
      province
      postalCode
      country
    }
  }
}
        `;

    let clientResponse = await makeRequest(query);

    return clientResponse.client;
}

/**
 * Runs Jobber payment query for given itemID, and returns the data
 * @param itemID The itemID in the webhook
 * @returns {Promise<*>} The data for the payment
 */
async function getPaymentData(itemID) {
    let query =
        `
query PaymentQuery {
    paymentRecord (id: "${itemID}") {
        client {
            id
        }
        adjustmentType
        amount
        details
        paymentOrigin
        paymentType
    }
}
        `;

    let paymentResponse = await makeRequest(query);

    paymentResponse["paymentRecord"].client = await getClientData(paymentResponse["paymentRecord"].client.id);

    return paymentResponse["paymentRecord"];
}

/**
 * Runs Jobber payment query for given itemID, and returns the data
 * @param itemID The itemID in the webhook
 * @returns {Promise<*>} The data for the payment
 */
async function getPayoutData(itemID) {
    let query =
        `
query PayoutQuery {
    payoutRecord (id: "${itemID}") {
        arrivalDate
        created
        currency
        feeAmount
        grossAmount
        id
        identifier
        netAmount
        payoutMethod
        status
        type
    }
}
        `;

    let payoutResponse = await makeRequest(query);

    return payoutResponse["payoutRecord"];
}

/**
 * Runs Jobber property query for given itemID, and returns the data
 * @param itemID The itemID in the webhook
 * @returns {Promise<*>} The data for the property
 */
async function getPropertyData(itemID) {
    let query =
        `
query PropertyQuery {
    property (id: "${itemID}") {
        address {
            id
        }
        client {
            id
        }
        isBillingAddress
        jobberWebUri
        routingOrder
        taxRate {
            id
        }
    }
}
        `;

    let propertyResponse = await makeRequest(query);

    propertyResponse["property"].client = await getClientData(propertyResponse["property"].client.id);

    return propertyResponse["property"];
}

/**
 * Runs Jobber visit query for given itemID, and returns the data
 * @param itemID The itemID in the webhook
 * @returns {Promise<*>} The data for the visit
 */
async function getVisitData(itemID) {
    let query =
        `
query VisitQuery {
    visit (id: "${itemID}") {
        allDay
        client {
            id
        }
        completedAt
        createdAt
        createdBy {
            name {
                full
            }
        }
        duration
        endAt
        instructions
        isComplete
        isDefaultTitle
        isLastScheduledVisit
        overrideOrder
        startAt
        title
        visitStatus
    }
}
        `;

    let visitResponse = await makeRequest(query);

    visitResponse["visit"].client = await getClientData(visitResponse["visit"].client.id);

    return visitResponse["visit"];
}

/**
 * Runs Jobber request query for given itemID, and returns the data
 * @param itemID The itemID in the webhook
 * @returns {Promise<*>} The data for the visit
 */
async function getRequestData(itemID) {
    let query =
        `
query RequestQuery {
    request (id: "${itemID}") {
        client {
            id
        }
        companyName
        contactName
        createdAt
        email
        jobberWebUri
        phone
        property {
            id
            address {
                street
                city
                province
                postalCode
            }
        }
        referringClient {
            id
            name
        }
        requestStatus
        source
        title
        updatedAt
    }
}
        `;

    let requestResponse = await makeRequest(query);

    requestResponse["request"].client = await getClientData(requestResponse["request"].client.id);

    return requestResponse["request"];
}

/**
 * Runs Jobber expense query for given itemID, and returns the data
 * @param itemID The itemID in the webhook
 * @returns {Promise<*>} The data for the payment
 */
async function getExpenseData(itemID) {
    let query =
        `
query ExpenseQuery {
    expense (id: "${itemID}") {
        createdAt
        date
        description
        enteredBy {
            id
        }
        id
        linkedJob {
            id
        }
        paidBy {
            id
        }
        reimbursableTo {
            id
        }
        title
        total
        updatedAt
    }
}
        `;

    let expenseResponse = await makeRequest(query);

    // Get the employee data and fill those fields
    if (expenseResponse.expense.enteredBy && expenseResponse.expense.enteredBy.id) {
        expenseResponse.expense.enteredBy = await getUserData(expenseResponse.expense.enteredBy.id)
    }
    if (expenseResponse.expense.paidBy && expenseResponse.expense.paidBy.id) {
        expenseResponse.expense.paidBy = await getUserData(expenseResponse.expense.paidBy.id)
    }
    if (expenseResponse.expense.reimbursableTo && expenseResponse.expense.reimbursableTo.id) {
        expenseResponse.expense.reimbursableTo = await getUserData(expenseResponse.expense.reimbursableTo.id)
    }

    return expenseResponse["expense"];
}

/**
 * Runs Jobber user query for given itemID, and returns the data
 * @param itemID The user ID
 * @returns {Promise<*>} The data for the payment
 */
async function getUserData(itemID) {
    let query =
        `
query UserQuery {
    user (id: "${itemID}") {
        id
        createdAt
        email {
            isValid
            raw
        }
        isAccountAdmin
        isAccountOwner
        lastLoginAt
        name {
            first
            last
            full
        }
        phone {
            areaCode
            countryCode
            friendly
            isValid
            raw
        }
        status
        uuid
    }
}
        `;

    let userResponse = await makeRequest(query);

    return userResponse["user"];
}

/**
 * Queries the Jobber API to get a list of open jobs, and performs tasks necessary to assign blame to people
 */
async function findOpenJobBlame() {
    let jobs = {};
    let openJobStatusTypes = [
        'requires_invoicing',
        'late',
        'action_required',
        'on_hold',
        'unscheduled',
        'active'
    ]

    for (let jobStatus of openJobStatusTypes) {
        let query =
            `
query OpenJobQuery {
    jobs (filter: {status: ${jobStatus}}) {
        nodes {
            id
            jobNumber
            title
            client {
                name
            }
            total
            customFields {
                ... on CustomFieldText {
                    label
                    valueText
                }
            }
            visits (first: 1) {
                nodes {
                    assignedUsers (first: 1) {
                        nodes {
                            name {
                                full
                            }
                        }
                    }
                }
            }
        }
    }
}
        `;

        let jobResponse = await makeRequest(query);

        for (let job of jobResponse.jobs.nodes) {
            let user = "unknown";
            if (job.visits.nodes.length > 0 && job.visits.nodes[0].assignedUsers.nodes.length > 0 && job.visits.nodes[0].assignedUsers.nodes[0].name.full) {
                // First, check if visit is assigned to user
                user = job.visits.nodes[0].assignedUsers.nodes[0].name.full;
            } else if (job.customFields.length > 0) {
                // Second, check if user put their name on the job
                for (let customField of job.customFields) {
                    if (customField.label === "Technician Name" && customField.valueText !== "") {
                        user = customField.valueText;
                    }
                }
            }
            // TODO: If neither of these works, we'll have to pull the Quote and Invoice to check if they did those properly

            if (!(user in jobs)) {
                jobs[user] = {};
            }

            if (!(`${job.jobNumber}` in jobs[user])) {
                jobs[user][job.jobNumber] = job;
            }
        }
    }

    return jobs;
}

module.exports = {
    verifyWebhook,
    setAuthorization,
    getInvoiceData,
    getInvoiceSearchData,
    getQuoteData,
    getQuoteSearchData,
    getJobData,
    getJobSearchData,
    getClientData,
    getPaymentData,
    getPayoutData,
    getPropertyData,
    getVisitData,
    getRequestData,
    getExpenseData,
    getUserData,
    findOpenJobBlame
};
