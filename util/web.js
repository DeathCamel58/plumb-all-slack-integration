require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
const express = require('express');
const path = require("path");
const app = express();
let Contact = require('./contact.js');
let { logContact } = require('./posthog.js');

// The port to run the webserver on.
port = 47092;

/**
 * TODO: Verify the authenticity of Jobber webhooks
 * @param webhookBody
 * @returns {Promise<void>}
 */
async function jobberAuthenticate(webhookBody) {
    let GOOGLE_KEY = process.env.GOOGLE_KEY || "testkey";
    if (webhookBody.google_key === GOOGLE_KEY) {
        await handleMessage(null, null, webhookBody, null)
    } else {
        console.log('Incoming webhook was not authenticated! Incoming follows:');
        console.log(webhookBody)
    }
}

app.post( '/jobber/:WEBHOOK_TYPE', ( req, res ) => {
    console.log("Jobber webhook received!");
    console.log(req.params);
    console.log("Data was");
    console.log(req.body);
    res.sendStatus( 200 );
} );

/**
 * TODO: Add webhooks
 */
app.get('/', (req, res) => {
    res.send("hello world");
})

app.listen( port, "0.0.0.0", () => console.log( `Node.js server started on port ${port}.` ) );
