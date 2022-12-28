require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
let fs = require('fs');
const express = require('express');
const bodyParser = require("body-parser");
const path = require("path");
let Contact = require('./contact.js');
let { invoiceWebhookHandle, clientWebhookHandle, quoteCreateWebhookHandle, quoteUpdateWebhookHandle } = require("./apis/JobberWebHookHandler.js");
let { jobberSetAuthorization } = require('./apis/Jobber.js');

// The app object
const app = express();
// The port to run the webserver on.
port = 47092;
// Use body-parser's JSON parsing
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/**
 * Handle Invoice Webhooks
 */
app.post( '/jobber/INVOICE_CREATE', ( req, res ) => {
    res.sendStatus( 200 );

    invoiceWebhookHandle(req);
} );

app.post( '/jobber/INVOICE_UPDATE', ( req, res ) => {
    res.sendStatus( 200 );

    // TODO: Maybe update the already existing invoice event to show remaining balance now?
    // invoiceWebhookHandle(req);
} );

/**
 * Handle Client Webhooks
 */
app.post( '/jobber/CLIENT_CREATE', ( req, res ) => {
    res.sendStatus( 200 );

    clientWebhookHandle(req);
} );

app.post( '/jobber/CLIENT_UPDATE', ( req, res ) => {
    res.sendStatus( 200 );

    clientWebhookHandle(req);
} );

/**
 * Handle Client Webhooks
 */
app.post( '/jobber/QUOTE_CREATE', ( req, res ) => {
    res.sendStatus( 200 );

    quoteCreateWebhookHandle(req);
} );

app.post( '/jobber/QUOTE_UPDATE', ( req, res ) => {
    res.sendStatus( 200 );

    quoteUpdateWebhookHandle(req);
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
                jobberSetAuthorization(req.query.code);
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
 * TODO: Add webhooks
 */
app.get('/', (req, res) => {
    res.send("hello world");
})

app.listen( port, "0.0.0.0", () => console.log( `Node.js server started on port ${port}.` ) );
