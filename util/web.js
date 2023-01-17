// noinspection JSIgnoredPromiseFromCall

require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
let fs = require('fs');
const express = require('express');
const bodyParser = require("body-parser");
let GoogleAds = require('./apis/GoogleAds.js');
let JobberWebHookHandler = require('./apis/JobberWebHookHandler.js');
let Jobber = require('./apis/Jobber.js');
let Slack = require('./apis/SlackBot');

// The app object
const app = express();
// The port to run the webserver on.
let port = Number(process.env.WEB_PORT);
// Use body-parser's JSON parsing
app.use(bodyParser.text({ type: 'application/json' }));

/**
 * Handle Invoice Webhooks
 */
app.post( '/jobber/INVOICE_CREATE', ( req, res ) => {
    console.info('Got an INVOICE_CREATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.invoiceHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

app.post( '/jobber/INVOICE_UPDATE', ( req, res ) => {
    console.info('Got an INVOICE_UPDATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        // TODO: Maybe update the already existing invoice event to show remaining balance now?
        // invoiceWebhookHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

/**
 * Handle Client Webhooks
 */
app.post( '/jobber/CLIENT_CREATE', ( req, res ) => {
    console.info('Got an CLIENT_CREATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.clientHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

app.post( '/jobber/CLIENT_UPDATE', ( req, res ) => {
    console.info('Got an CLIENT_UPDATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.clientHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

/**
 * Handle Quote Webhooks
 */
app.post( '/jobber/QUOTE_CREATE', ( req, res ) => {
    console.info('Got an QUOTE_CREATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.quoteCreateHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

app.post( '/jobber/QUOTE_UPDATE', ( req, res ) => {
    console.info('Got an QUOTE_UPDATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.quoteUpdateHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

/**
 * Handle Job Webhooks
 */
app.post( '/jobber/JOB_CREATE', ( req, res ) => {
    console.info('Got an JOB_CREATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.jobCreateHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

app.post( '/jobber/JOB_UPDATE', ( req, res ) => {
    console.info('Got an JOB_UPDATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.jobUpdateHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

/**
 * Handle Payment Webhooks
 */
app.post( '/jobber/PAYMENT_CREATE', ( req, res ) => {
    console.info('Got an PAYMENT_CREATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.paymentCreateHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

app.post( '/jobber/PAYMENT_UPDATE', ( req, res ) => {
    console.info('Got an PAYMENT_UPDATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.paymentUpdateHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

/**
 * Handle Payout Webhooks
 */
app.post( '/jobber/PAYOUT_CREATE', ( req, res ) => {
    console.info('Got an PAYOUT_CREATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.payoutCreateHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

app.post( '/jobber/PAYOUT_UPDATE', ( req, res ) => {
    console.info('Got an PAYOUT_UPDATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.payoutUpdateHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

/**
 * Handle Property Webhooks
 */
app.post( '/jobber/PROPERTY_CREATE', ( req, res ) => {
    console.info('Got an PROPERTY_CREATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.propertyCreateHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

app.post( '/jobber/PROPERTY_UPDATE', ( req, res ) => {
    console.info('Got an PROPERTY_UPDATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.propertyUpdateHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

//  TODO: Handle { WEBHOOK_TYPE: 'PROPERTY_DESTROY' }

/**
 * Handle Visit Webhooks
 */
app.post( '/jobber/VISIT_CREATE', ( req, res ) => {
    console.info('Got an VISIT_CREATE event from Jobber!');

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        // Webhook was valid.
        res.sendStatus( 200 );

        req.body = JSON.parse(req.body);
        // Process Request
        JobberWebHookHandler.visitCreateHandle(req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

/**
 * Handles a new Jobber Authorization Code, sets it in the config, then exits
 */
app.get( '/jobber/authorize', ( req, res ) => {
    res.sendStatus( 200 );

    // Process Request
    let file = process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env';
    let oldAuthCode = process.env.JOBBER_AUTHORIZATION_CODE;
    fs.readFile(file, 'utf8', function (err,data) {
        if (err) {
            return console.error(err);
        }

        let result = data.replace(oldAuthCode, req.query.code);

        fs.writeFile(file, result, 'utf8', function (err) {
            if (err) {
                console.error('Failed to save the Jobber Authorization Code to file.')
                console.error(err);
            } else {
                console.info('Received new Jobber authorization!');
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
        req.body = JSON.parse(req.body);

        // Check if this is a request to verify the endpoint
        if ("challenge" in req.body) {
            // Respond with the challenge
            res.send(req.body.challenge);
            console.info(`Received verification token ${req.body.challenge} from Slack.`)
        } else {
            res.sendStatus(200);
            // Process Request
            Slack.event(req);
        }
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
} );

/**
 * Google Ads Form Lead
 */
app.post( '/google-ads/form', ( req, res ) => {
    let data = JSON.parse(req.body);

    if (data["google_key"] === process.env.GOOGLE_ADS_KEY) {
        console.info('Webhook: Google Ads lead form received.');

        GoogleAds.LeadFormHandle(data);
        res.sendStatus( 200 );
    } else {
        console.error(`Webhook for Google Ads didn't have correct key.\n\tReceived: ${data["google_key"]}\n\tExpected: ${process.env.GOOGLE_ADS_KEY}`);
        res.sendStatus(401);
    }
} );

/**
 * TODO: Add webhooks
 */
app.get('/', (req, res) => {
    res.send("Hey! I'm plumb-all-slack integration. Plumb-All's Bot for stuff. This is not a website you should visit manually.");
});

app.listen( port, "0.0.0.0", () => console.info( `Node.js server started on port ${port}.` ) );
