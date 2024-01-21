// noinspection JSIgnoredPromiseFromCall

require('dotenv').config({path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env'});
let fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require("body-parser");
let GoogleAds = require('./apis/GoogleAds');
let SasoWebHookHandler = require('./apis/SasoWebHookHandler');
let JobberWebHookHandler = require('./apis/JobberWebHookHandler');
let Jobber = require('./apis/Jobber');
let Slack = require('./apis/SlackBot');
let CloudFlare = require('./apis/CloudFlareWorkers');
let FleetSharp = require('./apis/FleetSharp');

// The app object
const app = express();
// The port to run the webserver on.
let port = Number(process.env.WEB_PORT);
// Use body-parser's JSON parsing
app.use(bodyParser.text({type: 'application/json'}));

/**
 * Log unhandled SASO webhooks
 */
app.post('/saso/:WEBHOOK_TYPE', (req, res) => {
    console.log("SASO webhook received!");

    console.log(req.params);
    console.log("Data was");
    console.log(req.body);

    if (req.params['WEBHOOK_TYPE'] && req.params['WEBHOOK_TYPE'].startsWith('lead-source&')) {
        console.log("Got a lead with a source from SASO!");

        // Process Request
        SasoWebHookHandler.leadHandle(req);
    }

    res.sendStatus(200);
});

/**
 * Handle Jobber POST Webhooks
 */
app.post('/jobber/:WEBHOOK_TYPE', (req, res) => {
    console.info(`Got a ${req.params.WEBHOOK_TYPE} webhook from Jobber!`);

    // Set the default response code of 200
    let responseStatus = 200;

    // Verify that the webhook came from Jobber
    if (Jobber.verifyWebhook(req)) {
        if ("content-type" in req.headers && req.headers["content-type"] === "application/json") {
            req.body = JSON.parse(req.body);
        }

        // Process Request
        switch (req.params.WEBHOOK_TYPE) {
            case "INVOICE_CREATE":
                JobberWebHookHandler.invoiceHandle(req);
                break;
            case "INVOICE_UPDATE":
                // TODO: Maybe update the already existing invoice event to show remaining balance now?
                // invoiceWebhookHandle(req);
                break;
            // TODO: Handle { WEBHOOK_TYPE: 'INVOICE_DESTROY' }
            case "CLIENT_CREATE":
                JobberWebHookHandler.clientHandle(req);
                break;
            case "CLIENT_UPDATE":
                JobberWebHookHandler.clientHandle(req);
                break;
            // TODO: Handle { WEBHOOK_TYPE: 'CLIENT_DESTROY' }
            // TODO: Handle { WEBHOOK_TYPE: 'REQUEST_DESTROY' }
            case "QUOTE_CREATE":
                JobberWebHookHandler.quoteCreateHandle(req);
                break;
            case "QUOTE_UPDATE":
                JobberWebHookHandler.quoteUpdateHandle(req);
                break;
            // TODO: Handle { WEBHOOK_TYPE: 'QUOTE_DESTROY' }
            case "JOB_CREATE":
                JobberWebHookHandler.jobCreateHandle(req);
                break;
            case "JOB_UPDATE":
                JobberWebHookHandler.jobUpdateHandle(req);
                break;
            // TODO: Handle { WEBHOOK_TYPE: 'JOB_DESTROY' }
            case "PAYMENT_CREATE":
                JobberWebHookHandler.paymentCreateHandle(req);
                break;
            case "PAYMENT_UPDATE":
                JobberWebHookHandler.paymentUpdateHandle(req);
                break;
            // TODO: Handle { WEBHOOK_TYPE: 'PAYMENT_DESTROY' }
            case "PAYOUT_CREATE":
                JobberWebHookHandler.payoutCreateHandle(req);
                break;
            case "PAYOUT_UPDATE":
                JobberWebHookHandler.payoutUpdateHandle(req);
                break;
            case "PROPERTY_CREATE":
                JobberWebHookHandler.propertyCreateHandle(req);
                break;
            case "PROPERTY_UPDATE":
                JobberWebHookHandler.propertyUpdateHandle(req);
                break;
            // TODO: Handle { WEBHOOK_TYPE: 'PROPERTY_DESTROY' }
            case "VISIT_CREATE":
                JobberWebHookHandler.visitCreateHandle(req);
                break;
            case "VISIT_UPDATE":
                JobberWebHookHandler.visitUpdateHandle(req);
                break;
            case "VISIT_COMPLETE":
                JobberWebHookHandler.visitCompleteHandle(req);
                break;
            // TODO: Handle { WEBHOOK_TYPE: 'VISIT_DESTROY' }
            case "REQUEST_CREATE":
                JobberWebHookHandler.requestCreateHandle(req);
                break;
            case "REQUEST_UPDATE":
                JobberWebHookHandler.requestUpdateHandle(req);
                break;
            default:
                console.log("Data for unhandled webhook was");
                console.log(req.body);
                responseStatus = 405;
                break;
        }
    } else {
        // Webhook signature invalid. Send 401.
        responseStatus = 401;
    }

    // Send the response
    res.sendStatus(responseStatus);
});

/**
 * Handles a new Jobber Authorization Code, sets it in the config, then exits
 */
app.get('/jobber/authorize', (req, res) => {
    res.sendStatus(200);

    // Process Request
    let file = process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env';
    let oldAuthCode = process.env.JOBBER_AUTHORIZATION_CODE;
    fs.readFile(file, 'utf8', function (err, data) {
        if (err) {
            return console.error(err);
        }

        let result = data.replace(oldAuthCode, req.query.code);

        fs.writeFile(file, result, 'utf8', function (err) {
            if (err) {
                console.error('Failed to save the Jobber Authorization Code to file.');
                console.error(err);
            } else {
                console.info('Received new Jobber authorization!');
                // console.log('Received new Jobber authorization! Restarting now.');
                Jobber.setAuthorization(req.query.code);
            }
        });
    });
    process.env.JOBBER_AUTHORIZATION_CODE = req.query.code;
});

/**
 * Handle Slack Event Webhooks
 */
app.post('/slack/EVENT', (req, res) => {
    console.info('Got an EVENT from Slack!');

    // Verify that the webhook came from Slack
    if (Slack.verifyWebhook(req)) {
        // Webhook was valid.
        req.body = JSON.parse(req.body);

        // Check if this is a request to verify the endpoint
        if ("challenge" in req.body) {
            // Respond with the challenge
            res.send(req.body.challenge);
            console.info(`Received verification token ${req.body.challenge} from Slack.`);
        } else {
            res.sendStatus(200);
            // Process Request
            Slack.event(req);
        }
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
});

/**
 * Handle Slack Interactivity Webhooks
 * NOTE: We can't currently parse the web form posts. We don't care either, as it's not used by this.
 */
app.post('/slack/INTERACTIVITY', (req, res) => {
    console.info('Got an INTERACTIVITY from Slack!');

    // We don't need to verify that the webhook came from Slack
    // This is because we don't actually do anything about these requests. We only respond 200 to keep Slack from complaining.
    res.sendStatus(200);
});

/**
 * Google Ads Form Lead
 */
app.post('/google-ads/form', (req, res) => {
    let data = JSON.parse(req.body);

    if (data["google_key"] === process.env.GOOGLE_ADS_KEY) {
        console.info('Webhook: Google Ads lead form received.');
        res.sendStatus(200);

        GoogleAds.LeadFormHandle(data);
    } else {
        console.error(`Webhook for Google Ads didn't have correct key.\n\tReceived: "${data["google_key"]}"\n\tExpected: "${process.env.GOOGLE_ADS_KEY}"`);
        res.sendStatus(401);
    }
});

/**
 * CloudFlare Workers Contact Form
 */
app.post('/cloudflare/contactForm', (req, res) => {
    let data = JSON.parse(req.body);

    if (data["cloudflare_key"] === process.env.CLOUDFLARE_CONTACT_FORM_KEY) {
        console.info('Webhook: CloudFlare Workers contact form received.');
        res.sendStatus(200);

        CloudFlare.ContactFormHandle(data);
    } else {
        console.error(`Webhook for CloudFlare Workers didn't have correct key.\n\tReceived: "${data["cloudflare_key"]}"\n\tExpected: "${process.env.GOOGLE_ADS_KEY}"`);
        res.sendStatus(401);
    }
});

/**
 * FleetSharp Alerts
 */
app.post('/fleetsharp/alerts', (req, res) => {
    let data = JSON.parse(req.body);

    // Return a `201`, as this is what the documentation specifies as our response
    res.sendStatus(201);

    FleetSharp.AlertHandle(data);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../assets/index.html'));
});

app.get('/openapi.yaml', (req, res) => {
    res.sendFile(path.join(__dirname, '../assets/openapi.yaml'));
});

app.listen(port, "0.0.0.0", () => console.info(`Node.js server started on port ${port}.`));
