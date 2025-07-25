// noinspection JSIgnoredPromiseFromCall

import fs from "fs";
import path from "path";
import express from "express";
import bodyParser from "body-parser";
import events from "./events.js";
import * as Jobber from "./apis/Jobber.js";
import * as Slack from "./apis/SlackBot.js";
import * as Sentry from "@sentry/node";
import cors from "cors";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The app object
const app = express();
// The port to run the webserver on.
let port = Number(process.env.WEB_PORT);
// Use body-parser's JSON parsing
app.use(bodyParser.text({ type: "application/json" }));

// This saves the raw body data to `rawBody` in the req
app.use((req, res, next) => {
  req.rawBody = "";

  req.on("data", function (chunk) {
    req.rawBody += chunk;
  });

  // call next() outside of 'end' after setting 'data' handler
  next();
});

app.use(express.urlencoded({ extended: true })); // support encoded bodies

/**
 * Log unhandled SASO webhooks
 */
app.post("/saso/:WEBHOOK_TYPE", (req, res) => {
  console.log("Web: SASO webhook received!");

  // Log this data *no matter what* so that tracing issues on mission-critical stuff is easier
  console.log("Web: Data was");
  console.log(req.params);
  console.log(req.body);

  if (
    req.params["WEBHOOK_TYPE"] &&
    req.params["WEBHOOK_TYPE"].startsWith("lead-source")
  ) {
    console.log("Web: Got a lead with a source from SASO!");

    // Emit Event
    events.emit("saso-lead", req);
  }

  res.sendStatus(200);
});

/**
 * Handle Jobber POST Webhooks
 */
app.post("/jobber/:WEBHOOK_TYPE", (req, res) => {
  console.info(`Web: Got a ${req.params.WEBHOOK_TYPE} webhook from Jobber!`);

  if (process.env.DEBUG === "TRUE") {
    console.log("Jobber Webhook: Data was");
    console.log(req.body);
  }

  // Set the default response code of 200
  let responseStatus = 200;

  // Verify that the webhook came from Jobber
  if (Jobber.verifyWebhook(req)) {
    if (
      "content-type" in req.headers &&
      req.headers["content-type"] === "application/json"
    ) {
      req.body = JSON.parse(req.body);
    }

    // Process Request
    // This checks if the given webhook type has listeners, and if so, we fire that event
    const listenerName = `jobber-${req.params.WEBHOOK_TYPE}`;
    if (events.listenerCount(listenerName) > 0) {
      events.emit(listenerName, req);
    } else {
      console.log("Web: Data for unhandled webhook was");
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
app.get("/jobber/authorize", (req, res) => {
  res.sendStatus(200);

  // Process Request
  let file =
    process.env.ENV_LOCATION || "/root/plumb-all-slack-integration/.env";
  let oldAuthCode = process.env.JOBBER_AUTHORIZATION_CODE;
  fs.readFile(file, "utf8", function (err, data) {
    if (err) {
      return console.error(err);
    }

    let result = data.replace(oldAuthCode, req.query.code);

    // Write data into a new file
    fs.writeFileSync(`${file}2`, result, "utf8");

    // Ensure the new file isn't empty, then delete the original, and move new into the original's place
    if (fs.statSync(`${file}2`)["size"] > 0) {
      fs.unlinkSync(file);
      fs.renameSync(`${file}2`, file);
    } else {
      console.error(
        "Web: ERROR: New file is empty. Dumping variables and arguments to assist with debugging.",
      );
      console.info(`\toldAuthCode:\t${oldAuthCode}`);
      console.info(`\treq.query.code:\t${req.query.code}`);
      console.info(`\tdata:\t${data}`);
    }
  });
  process.env.JOBBER_AUTHORIZATION_CODE = req.query.code;

  Jobber.getRefreshToken();

  events.emit("jobber-AUTHORIZATION", req);
});

/**
 * Handle Slack Event Webhooks
 */
app.post("/slack/EVENT", (req, res) => {
  console.info("Web: Got an EVENT from Slack!");

  // Verify that the webhook came from Slack
  if (Slack.verifyWebhook(req)) {
    // Webhook was valid.
    req.body = JSON.parse(req.body);

    // Check if this is a request to verify the endpoint
    if ("challenge" in req.body) {
      // Respond with the challenge
      res.send(req.body.challenge);
      console.info(
        `Web: Received verification token ${req.body.challenge} from Slack.`,
      );
    } else {
      res.sendStatus(200);

      events.emit("slack-EVENT", req);
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
app.post("/slack/INTERACTIVITY", (req, res) => {
  console.info("Web: Got an INTERACTIVITY from Slack!");

  // Verify that the webhook came from Slack
  if (Slack.verifyWebhook(req, true)) {
    // Webhook was valid.
    req.body.payload = JSON.parse(req.body.payload);

    events.emit("slack-INTERACTIVITY", req);
  } else {
    // Webhook signature invalid. Send 401.
    res.sendStatus(401);
  }
});

/**
 * Handle Mattermost request for open jobs
 */
app.get("/mattermost/jobberOpenJobs", (req, res) => {
  console.info("Web: Got a request for open jobs from Mattermost!");

  // Verify that the webhook came from Slack
  if (req.query.token === process.env.MATTERMOST_WEBHOOK_OPEN_JOBS_TOKEN) {
    // Webhook was valid.
    events.emit("mattermost-open-jobs", req);
    const returnedData = {
      response_type: "ephemeral",
      text: ":gear: Generating Open Jobs List :gear:",
    };
    res.json(returnedData);
  } else {
    // Webhook signature invalid. Send 401.
    res.sendStatus(401);
  }
});

/**
 * Google Ads Form Lead
 */
app.post("/google-ads/form", (req, res) => {
  let data = JSON.parse(req.body);

  if (data["google_key"] === process.env.GOOGLE_ADS_KEY) {
    console.info("Web: Google Ads lead form received.");
    res.sendStatus(200);

    events.emit("google-ads-form", req);
  } else {
    const message = `Web: Google Ads Webhook: Incorrect Key. ${data["google_key"]} Expected: "${process.env.GOOGLE_ADS_KEY}`;
    console.error(message);
    Sentry.captureException(message);
    res.sendStatus(401);
  }
});

/**
 * CloudFlare Workers Contact Form
 */
app.post("/cloudflare/contactForm", (req, res) => {
  req.body = JSON.parse(req.body);
  let data = req.body;

  if (data["cloudflare_key"] === process.env.CLOUDFLARE_CONTACT_FORM_KEY) {
    console.info("Web: CloudFlare Workers contact form received.");
    res.sendStatus(200);

    events.emit("cloudflare-contact-form", req);
  } else {
    const message = `Web: Cloudflare Workers Webhook: Incorrect Key. ${data["cloudflare_key"]} Expected: "${process.env.CLOUDFLARE_CONTACT_FORM_KEY}`;
    console.error(message);
    Sentry.captureException(message);
    console.error(message);
    res.sendStatus(401);
  }
});

/**
 * FleetSharp Alerts
 */
app.post("/fleetsharp/alerts", (req, res) => {
  // Return a `201`, as this is what the documentation specifies as our response
  res.sendStatus(201);

  events.emit("fleetsharp-alert", req);
});

/**
 * Verisae Notification
 */
app.post("/verisae/ingles", (req, res) => {
  req.body = JSON.parse(req.body);
  let data = req.body;

  if (data.payload.sender.includes("plumb-all.com")) {
    console.info("Web: Verisae (Ingles) email received.");
    res.sendStatus(200);

    events.emit("verisae-ingles", data);
  } else {
    const message = `Web: Verisae Webhook: Email not from us. From ${data.payload.sender}`;
    console.error(message);
    Sentry.captureException(message);
    res.sendStatus(401);
  }
});

/**
 * 86 Repairs Notification
 */
app.post("/86repairs/call", (req, res) => {
  req.body = JSON.parse(req.body);
  let data = req.body;

  if (data.payload.sender.includes("plumb-all.com")) {
    console.info("Web: 86 Repairs email received.");
    res.sendStatus(200);

    events.emit("86repairs-call", data);
  } else {
    const message = `Web: 86 Repairs email not from us. From ${data.payload.sender}`;
    console.error(message);
    Sentry.captureException(message);
    res.sendStatus(401);
  }
});

const corsOptions = {
  origin: "https://plumb-all.com",
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
};

/**
 * Website form Notification
 */
app.options("/website/contactForm", cors(corsOptions));
app.post("/website/contactForm", cors(corsOptions), (req, res) => {
  req.body = JSON.parse(req.body);
  let data = req.body;

  console.info("Web: Website contact form received.");

  res.sendStatus(200);

  events.emit("website-contact", data);
});

/**
 * Website negative feedback form Notification
 */
app.options("/website/negativeFeedback", cors(corsOptions));
app.post("/website/negativeFeedback", cors(corsOptions), (req, res) => {
  req.body = JSON.parse(req.body);
  let data = req.body;

  console.info("Web: Website negative feedback form received.");

  res.sendStatus(200);

  events.emit("website-negative-feedback", data);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../assets/index.html"));
});

app.get("/openapi.yaml", (req, res) => {
  res.sendFile(path.join(__dirname, "../assets/openapi.yaml"));
});

app.listen(port, "0.0.0.0", () =>
  console.info(`Web: Node.js server started on port ${port}.`),
);
