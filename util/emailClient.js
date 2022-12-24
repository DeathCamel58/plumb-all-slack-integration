require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
require('isomorphic-fetch');
const { ClientSecretCredential } = require("@azure/identity");
const {Client} = require("@microsoft/microsoft-graph-client");
const { TokenCredentialAuthenticationProvider } = require("@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials");

// Create an instance of the TokenCredential class that is imported
const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);

// Set your scopes and options for TokenCredential.getToken (Check the ` interface GetTokenOptions` in (TokenCredential Implementation)[https://github.com/Azure/azure-sdk-for-js/blob/master/sdk/core/core-auth/src/tokenCredential.ts])

const authProvider = new TokenCredentialAuthenticationProvider(credential, { scopes: ["https://graph.microsoft.com/.default"] });

const client = Client.initWithMiddleware({
    debugLogging: (!!process.env.DEBUGGING),
    authProvider,
});

/**
 * Gets unread emails in the Inbox of the user.
 * NOTE: This only returns up to 100 emails.
 * @returns {Promise<any>}
 */
async function getMail() {
    let response = await client.api(`/users/${(process.env.EMAIL_ADDRESS || "")}/mailFolders/Inbox/messages?$filter=isRead eq false&top=100`).header('Prefer','outlook.body-content-type="text"').get();

    return response.value;
}

/**
 * Gets unread emails in the Inbox of the user.
 * NOTE: This only returns up to 100 emails.
 * @returns {Promise<any>}
 */
async function moveMarkEmail(email, fromWhere) {
    // Initialize the response object.
    let response = undefined;

    // Create a dictionary of all folders and ID's
    let folders = {}
    try {
        response = await client.api(`/users/${(process.env.EMAIL_ADDRESS || "")}/mailFolders?$top=100`).get();
    } catch (e) {
        console.log(`Failed to get a list of folders from email.`);
        console.log(e);
    }
    if (response.value.length !== 0) {
        for (const folder of response.value) {
            folders[folder.displayName] = folder.id;
        }
    }

    // Figure out which email folder to move this to.
    let destinationFolder = undefined;
    if (fromWhere === "Call") {
        destinationFolder = folders["Answering Service"];
    } else if (fromWhere === "Website") {
        destinationFolder = folders["Website Contact"];
    } else if (fromWhere === "Jobber Request") {
        destinationFolder = folders["Jobber Request"];
    } else {
        console.log("Not sure where to move this email:");
        console.log(email);
        return;
    }

    // Mark as read
    let message = {
        isRead: true
    }
    try {
        response = await client.api(`/users/${(process.env.EMAIL_ADDRESS || "")}/messages/${email.id}`).update(message);
    } catch (e) {
        console.log(`Failed to mark email as read: ${email.id}`);
        console.log(e)
    }

    // Move the email
    message = {
        destinationID: destinationFolder
    }
    try {
        response = await client.api(`/users/${(process.env.EMAIL_ADDRESS || "")}/messages/${email.id}/move`).post(message);
    } catch (e) {
        console.log(`Failed to move: ${email.id}`);
        console.log(e)
    }
}

module.exports = {
    getMail,
    moveMarkEmail
}