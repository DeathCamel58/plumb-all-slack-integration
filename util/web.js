require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
let fs = require('fs');
const express = require('express');
const bodyParser = require("body-parser");
const path = require("path");
let Contact = require('./contact.js');
let {
    invoiceWebhookHandle,
    clientWebhookHandle,
    quoteCreateWebhookHandle,
    quoteUpdateWebhookHandle,
    jobCreateWebhookHandle,
    paymentCreateWebhookHandle
} = require("./apis/JobberWebHookHandler.js");
let Jobber = require('./apis/Jobber.js');
let Slack = require('./apis/SlackBot');

// The app object
const app = express();
// The port to run the webserver on.
port = 47092;
// Use body-parser's JSON parsing
app.use(bodyParser.text({ type: 'application/json' }));

/**
 * Handle Invoice Webhooks
 */
app.post( '/jobber/INVOICE_CREATE', ( req, res ) => {
    console.info('Got an INVOICE_CREATE event from Jobber!');
    res.sendStatus( 200 );

    invoiceWebhookHandle(req);
} );

app.post( '/jobber/INVOICE_UPDATE', ( req, res ) => {
    console.info('Got an INVOICE_UPDATE event from Jobber!');
    res.sendStatus( 200 );

    // TODO: Maybe update the already existing invoice event to show remaining balance now?
    // invoiceWebhookHandle(req);
} );

/**
 * Handle Client Webhooks
 */
app.post( '/jobber/CLIENT_CREATE', ( req, res ) => {
    console.info('Got an CLIENT_CREATE event from Jobber!');
    res.sendStatus( 200 );

    clientWebhookHandle(req);
} );

app.post( '/jobber/CLIENT_UPDATE', ( req, res ) => {
    console.info('Got an CLIENT_UPDATE event from Jobber!');
    res.sendStatus( 200 );

    clientWebhookHandle(req);
} );

/**
 * Handle Quote Webhooks
 */
app.post( '/jobber/QUOTE_CREATE', ( req, res ) => {
    console.info('Got an QUOTE_CREATE event from Jobber!');
    res.sendStatus( 200 );

    quoteCreateWebhookHandle(req);
} );

app.post( '/jobber/QUOTE_UPDATE', ( req, res ) => {
    console.info('Got an QUOTE_UPDATE event from Jobber!');
    res.sendStatus( 200 );

    quoteUpdateWebhookHandle(req);
} );

/**
 * Handle Job Webhooks
 */
app.post( '/jobber/JOB_CREATE', ( req, res ) => {
    console.info('Got an JOB_CREATE event from Jobber!');
    res.sendStatus( 200 );

    jobCreateWebhookHandle(req);
} );

/**
 * Handle Payment Webhooks
 */
app.post( '/jobber/PAYMENT_CREATE', ( req, res ) => {
    console.info('Got an PAYMENT_CREATE event from Jobber!');
    res.sendStatus( 200 );

    paymentCreateWebhookHandle(req);
} );

/**
 * Handles a new Jobber Authorization Code, sets it in the config, then exits
 */
app.get( '/jobber/authorize', ( req, res ) => {
    let file = process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env';
    res.sendStatus( 200 );
    let oldAuthCode = process.env.JOBBER_AUTHORIZATION_CODE;
    fs.readFile(file, 'utf8', function (err,data) {
        if (err) {
            return console.log(err);
        }

        let result = data.replace(oldAuthCode, req.query.code);

        fs.writeFile(file, result, 'utf8', function (err) {
            if (err) {
                console.log('Failed to save the Jobber Authorization Code to file.')
                console.log(err);
            } else {
                console.log('Received new Jobber authorization!');
                // console.log('Received new Jobber authorization! Restarting now.');
                Jobber.setAuthorization(req.query.code);
            }
        });
    });
    process.env.JOBBER_AUTHORIZATION_CODE = req.query.code;
} );

/**
 * Log all other webhooks
 */
app.post( '/jobber/:WEBHOOK_TYPE', ( req, res ) => {
    console.log("Unhandled Jobber webhook received!");
    console.log(req.params);
    console.log("Data was");
    console.log(req.body);
    res.sendStatus( 200 );
} );

/**
 * Handle Slack Event Webhooks
 */
app.post( '/slack/EVENT', ( req, res ) => {
    console.info('Got an EVENT from Slack!');

    // Verify that the webhook came from Slack
    if (Slack.verifyWebhook(req)) {
        // Webhook was valid.
        // Respond with the challenge
        res.send(req.body.challenge);
        req.body = JSON.parse(req.body);
        // Process Request
        Slack.event(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

/**
 * TODO: Add webhooks
 */
app.get('/', (req, res) => {
    res.send("Hey! I'm plumb-all-slack integration. Plumb-All's Bot for stuff. This is not a website you should visit manually.");
})

app.listen( port, "0.0.0.0", () => console.log( `Node.js server started on port ${port}.` ) );
