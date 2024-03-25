// noinspection JSIgnoredPromiseFromCall

require('dotenv').config({path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env'});
let fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require("body-parser");
const events = require('./events');
let Jobber = require('./apis/Jobber');
let Slack = require('./apis/SlackBot');

// The app object
const app = express();
// The port to run the webserver on.
let port = Number(process.env.WEB_PORT);
// Use body-parser's JSON parsing
app.use(bodyParser.text({type: 'application/json'}));

// This saves the raw body data to `rawBody` in the req
app.use((req, res, next) => {
    req.rawBody = '';

    req.on('data', function(chunk) {
        req.rawBody += chunk;
    });

    // call next() outside of 'end' after setting 'data' handler
    next();
});

app.use(express.urlencoded({ extended: true })); // support encoded bodies

/**
 * Log unhandled SASO webhooks
 */
app.post('/saso/:WEBHOOK_TYPE', (req, res) => {
    console.log("SASO webhook received!");

    console.log(req.params);
    console.log("Data was");
    console.log(req.body);

    if (req.params['WEBHOOK_TYPE'] && req.params['WEBHOOK_TYPE'].startsWith('lead-source')) {
        console.log("Got a lead with a source from SASO!");

        // Emit Event
        events.emitter.emit('saso-lead', req);
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
        // This checks if the given webhook type has listeners, and if so, we fire that event
        const listenerName = `jobber-${req.params.WEBHOOK_TYPE}`;
        if (events.emitter.listenerCount(listenerName) > 0) {
            events.emitter.emit(listenerName, req);
        } else {
            console.log("Data for unhandled webhook was");
            console.log(req.body);
            responseStatus = 405;
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

        // Write data into a new file
        fs.writeFile(`${file}2`, result, 'utf8', function (err) {
            // Ensure the new file isn't empty, then delete original, and move new into the original's place
            if (fs.statSync(`${file}2`)["size"] > 0) {
                fs.unlink(file);
                fs.renameSync(`${file}2`, file);
            } else {
                console.error('ERROR: New file is empty. Dumping variables and arguments to assist with debugging.');
                console.info(`\toldAuthCode:\t${oldAuthCode}`);
                console.info(`\treq.query.code:\t${req.query.code}`);
                console.info(`\tdata:\t${data}`);
            }
            
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

    events.emitter.emit('jobber-AUTHORIZATION', req);
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

            events.emitter.emit('slack-EVENT', req);
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

    // Verify that the webhook came from Slack
    if (Slack.verifyWebhook(req, true)) {
        // Webhook was valid.
        req.body.payload = JSON.parse(req.body.payload)

        events.emitter.emit('slack-INTERACTIVITY', req);
    } else {
        // Webhook signature invalid. Send 401.
        res.sendStatus(401);
    }
});

/**
 * Google Ads Form Lead
 */
app.post('/google-ads/form', (req, res) => {
    let data = JSON.parse(req.body);

    if (data["google_key"] === process.env.GOOGLE_ADS_KEY) {
        console.info('Webhook: Google Ads lead form received.');
        res.sendStatus(200);

        events.emitter.emit('google-ads-form', req);
    } else {
        console.error(`Webhook for Google Ads didn't have correct key.\n\tReceived: "${data["google_key"]}"\n\tExpected: "${process.env.GOOGLE_ADS_KEY}"`);
        res.sendStatus(401);
    }
});

/**
 * CloudFlare Workers Contact Form
 */
app.post('/cloudflare/contactForm', (req, res) => {
    req.body = JSON.parse(req.body);
    let data = req.body;

    if (data["cloudflare_key"] === process.env.CLOUDFLARE_CONTACT_FORM_KEY) {
        console.info('Webhook: CloudFlare Workers contact form received.');
        res.sendStatus(200);

        events.emitter.emit('cloudflare-contact-form', req);
    } else {
        console.error(`Webhook for CloudFlare Workers didn't have correct key.\n\tReceived: "${data["cloudflare_key"]}"\n\tExpected: "${process.env.GOOGLE_ADS_KEY}"`);
        res.sendStatus(401);
    }
});

/**
 * FleetSharp Alerts
 */
app.post('/fleetsharp/alerts', (req, res) => {
    // Return a `201`, as this is what the documentation specifies as our response
    res.sendStatus(201);

    events.emitter.emit('fleetsharp-alert', req);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../assets/index.html'));
});

app.get('/openapi.yaml', (req, res) => {
    res.sendFile(path.join(__dirname, '../assets/openapi.yaml'));
});

app.listen(port, "0.0.0.0", () => console.info(`Node.js server started on port ${port}.`));
