require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
const fetch = require('node-fetch');
const { sendRawMessage } = require("../slackBot");
const crypto = require("crypto");
const fs = require("fs");


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

function jobberSetAuthorization(code) {
    console.log(`Replacing first Authorization with second.\n${process.env.JOBBER_AUTHORIZATION_CODE}\n${code}`);
    process.env.JOBBER_AUTHORIZATION_CODE = code;
    console.log(`It is now: ${process.env.JOBBER_AUTHORIZATION_CODE}`);
}

async function requestJobberAuthorization() {
    let redirect_URI = `${process.env.WEB_URL}/jobber/authorize`;
    redirect_URI = encodeURIComponent(redirect_URI);
    let STATE = crypto.randomBytes(16).toString('hex');
    await sendRawMessage(`Error from the call bot. *Super technical error code*: :robot_face::frowning::thumbsdown:\nI\'ve lost my access to Jobber and I need some help.\nI need an admin in Jobber to click on --><https://api.getjobber.com/api/oauth/authorize?client_id=${process.env.JOBBER_CLIENT_ID}&redirect_uri=${redirect_URI}&state=${STATE}|this link><-- and click \`ALLOW ACCESS\`.`);
    await sleep(30*1000)
}

/**
 * Updates the access token when it's found to be invalid.
 * @returns {Promise<void>}
 */
async function refreshAccessToken() {
    let success = false;
    let response;
    while (!success) {
        let response = await fetch(`https://api.getjobber.com/api/oauth/token?client_id=${process.env.JOBBER_CLIENT_ID}&client_secret=${process.env.JOBBER_APP_SECRET}&grant_type=authorization_code&code=${process.env.JOBBER_AUTHORIZATION_CODE}`, {
            method: 'post'
        });

        if ( response.status === 200 ) {
            success = true;
            data = await response.text();
            data = JSON.parse(data);
            JOBBER_ACCESS_TOKEN = data.access_token;
            let refresh_token = data.refresh_token;

            // Save the refresh token to file
            let file = process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env';
            fs.readFile(file, 'utf8', function (err,data) {
                if (err) {
                    return console.log(err);
                }

                let result = data.replace(process.env.JOBBER_REFRESH_TOKEN, refresh_token);
                process.env.JOBBER_REFRESH_TOKEN = refresh_token;

                fs.writeFile(file, result, 'utf8', function (err) {
                    if (err) {
                        console.log('Failed to save the Jobber Refresh Token to file.')
                        console.log(err);
                    } else {
                        console.log('Received new Jobber Refresh Token!');
                    }
                });
            });
        }
        if ( response.status === 401 ) {
            console.log(`Got ${response.status} while refreshing access token. Requesting authorization!`);
            await requestJobberAuthorization();
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
        response = await fetch(JOBBER_BASE_URL, {
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JOBBER_ACCESS_TOKEN}`
            },
            body: `{"query":${JSON.stringify(query)}}`
        });

        if ( response.status === 200 ) {
            success = true;
        }
        if ( response.status === 401 ) {
            console.log(`Got ${response.status} from the Jobber API. Refreshing access token and trying again!`)
            await refreshAccessToken();
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
    }
}
        `;

    let invoiceResponse = await makeRequest(query);

    let client = await getClientData(invoiceResponse.invoice.client.id);

    invoiceResponse.invoice.client = client;

    return invoiceResponse.invoice;
}

/**
 * Runs Jobber Client query for given itemID, and returns the data
 * @param itemID The itemID in the webhook
 * @returns {Promise<*>} The data for the invoice
 */
async function getClientData(itemID) {
    let query =
        `
query ClientQuery {
  client (id: "${itemID}") {
    name
    defaultEmails
    phones {
      number
      primary
    }
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

    let response = await makeRequest(query);

    return response.client;
}

module.exports = {
    getInvoiceData,
    getClientData,
    jobberSetAuthorization
};
