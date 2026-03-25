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
import { getFile } from "./mediaStore.js";
import {
  listTrackers,
  updateAllTrackerDestinations,
  listCallsWithValueAndGclid,
  verifyWebhook as verifyCallRailWebhook,
} from "./apis/CallRail.js";
import { uploadConversionAdjustment } from "./apis/GoogleAdsConversions.js";
import { toE164, normalizePhoneNumber } from "./DataUtilities.js";
import Contact from "./contact.js";
import * as APICoordinator from "./APICoordinator.js";
import {
  handleBridge,
  handleBridgeAfterDial,
  handleBridgeConfirm,
  handleInboundCall,
  handleInboundAfterDial,
  handleInboundScreen,
  handleInboundScreenConfirm,
  handleInboundSms,
  handleVoicemailAction,
  handleRecordingDone,
} from "./apis/Twilio.js";

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
      try {
        req.body = JSON.parse(req.body);
      } catch (e) {
        console.error("Web: Invalid JSON in Jobber webhook body");
        res.sendStatus(400);
        return;
      }
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
 * Handle CallRail POST Webhooks
 */
app.post("/callrail/:WEBHOOK_TYPE", (req, res) => {
  console.info(`Web: Got a ${req.params.WEBHOOK_TYPE} webhook from CallRail!`);

  if (process.env.DEBUG === "TRUE") {
    console.log("CallRail Webhook: Data was");
    console.log(req.body);
  }

  let responseStatus = 200;

  if (verifyCallRailWebhook(req)) {
    if (
      "content-type" in req.headers &&
      req.headers["content-type"].includes("application/json")
    ) {
      try {
        req.body = JSON.parse(req.body);
      } catch (e) {
        console.error("Web: Invalid JSON in CallRail webhook body");
        res.sendStatus(400);
        return;
      }
    }

    const listenerName = `callrail-${req.params.WEBHOOK_TYPE}`;
    if (events.listenerCount(listenerName) > 0) {
      events.emit(listenerName, req);
    } else {
      console.log(
        `Web: No handler for CallRail webhook type: ${req.params.WEBHOOK_TYPE}`,
      );
      console.log("Web: Data for unhandled CallRail webhook was");
      console.log(req.body);
      responseStatus = 405;
    }
  } else {
    responseStatus = 401;
  }

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
    try {
      req.body = JSON.parse(req.body);
    } catch (e) {
      console.error("Web: Invalid JSON in Slack EVENT body");
      res.sendStatus(400);
      return;
    }

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
    try {
      req.body.payload = JSON.parse(req.body.payload);
    } catch (e) {
      console.error("Web: Invalid JSON in Slack INTERACTIVITY payload");
      res.sendStatus(400);
      return;
    }

    events.emit("slack-INTERACTIVITY", req);

    res.json({});
  } else {
    // Webhook signature invalid. Send 401.
    res.sendStatus(401);
  }
});

/**
 * Handle Slack Command Webhooks
 */
app.post("/slack/COMMAND", (req, res) => {
  console.info("Web: Got a COMMAND from Slack!");

  // Verify that the webhook came from Slack
  if (Slack.verifyWebhook(req, true)) {
    // Webhook was valid.
    events.emit("slack-COMMAND", req, res);
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
  let data;
  try {
    data = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).send("Invalid JSON");
  }

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
  try {
    req.body = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).send("Invalid JSON");
  }
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
  try {
    req.body = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).send("Invalid JSON");
  }
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
  try {
    req.body = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).send("Invalid JSON");
  }
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

/**
 * Rentvine Work Order Assignment
 */
app.post("/rentvine/work_order", (req, res) => {
  try {
    req.body = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).send("Invalid JSON");
  }
  let data = req.body;

  console.info("Web: Got a work order email from Rentvine!");
  res.sendStatus(200);

  events.emit("rentvine-work-order", data);
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
  try {
    req.body = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).send("Invalid JSON");
  }
  let data = req.body;

  console.info("Web: Website contact form received.");

  res.sendStatus(200);

  events.emit("website-contact", data);
});

/**
 * Twilio Inbound Voice Webhook
 * - Twilio sends From/To as form-urlencoded fields
 * - We respond with TwiML to bridge the caller to the assigned employee (or fallback)
 * - We record the bridged conversation
 */
app.post("/twilio/voice", async (req, res) => {
  const callResponse = await handleInboundCall(req, res);

  res.type("text/xml").send(callResponse);
});

/**
 * Twilio Inbound Voice - call screening (Press 1)
 */
app.post("/twilio/voice/screen", async (req, res) => {
  const callResponse = await handleInboundScreen(req, res);

  res.type("text/xml").send(callResponse);
});

/**
 * Twilio Inbound Voice - call screening confirmation
 */
app.post("/twilio/voice/screen/confirm", async (req, res) => {
  const callResponse = await handleInboundScreenConfirm(req, res);

  res.type("text/xml").send(callResponse);
});

/**
 * Twilio Inbound Voice - post-dial fallback (voicemail)
 */
app.post("/twilio/voice/after-dial", async (req, res) => {
  const callResponse = await handleInboundAfterDial(req, res);

  res.type("text/xml").send(callResponse);
});

/**
 * Twilio Inbound Voice - voicemail action (detect no voicemail)
 */
app.post("/twilio/voice/voicemail-action", async (req, res) => {
  await handleVoicemailAction(req, res);
});

/**
 * Twilio Inbound SMS Webhook
 * - Twilio sends From/To as form-urlencoded fields
 * - We send the message to Slack
 */
app.post("/twilio/sms", async (req, res) => {
  const messageResponse = await handleInboundSms(req, res);

  res.type("text/xml").send(messageResponse);
});

/**
 * Twilio Bridge
 */
app.post("/twilio/bridge", async (req, res) => {
  const callResponse = await handleBridge(req, res);

  res.type("text/xml").send(callResponse);
});

/**
 * Twilio Bridge confirmation (Press 1)
 */
app.post("/twilio/bridge/confirm", async (req, res) => {
  const callResponse = await handleBridgeConfirm(req, res);

  res.type("text/xml").send(callResponse);
});

/**
 * Twilio Bridge post-dial callback (busy, no-answer, failed)
 */
app.post("/twilio/bridge/after-dial", (req, res) => {
  const callResponse = handleBridgeAfterDial(req, res);

  res.type("text/xml").send(callResponse);
});

/**
 * Twilio Recording Status Webhook
 */
app.post("/twilio/recording-status", (req, res) => {
  return handleRecordingDone(req, res);
});

/**
 * Website negative feedback form Notification
 */
app.options("/website/negativeFeedback", cors(corsOptions));
app.post("/website/negativeFeedback", cors(corsOptions), (req, res) => {
  try {
    req.body = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).send("Invalid JSON");
  }
  let data = req.body;

  console.info("Web: Website negative feedback form received.");

  res.sendStatus(200);

  events.emit("website-negative-feedback", data);
});

/**
 * Temporary media file serving (for Twilio MMS attachments)
 */
app.get("/media/:token", (req, res) => {
  const entry = getFile(req.params.token);
  if (!entry) return res.status(404).send("Not found");
  res.type(entry.contentType).send(entry.buffer);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../assets/index.html"));
});

app.get("/openapi.yaml", (req, res) => {
  res.sendFile(path.join(__dirname, "../assets/openapi.yaml"));
});

/**
 * Dashboard auth middleware — HTTP Basic Auth using DASHBOARD_KEY as both username and password.
 */
function dashboardAuth(req, res, next) {
  const key = process.env.DASHBOARD_KEY;
  if (!key) {
    return res.status(503).send("Dashboard not configured");
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Plumb-All Dashboard"');
    return res.status(401).send("Authentication required");
  }

  const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
  const [user, pass] = decoded.split(":");

  if (user !== key || pass !== key) {
    res.set("WWW-Authenticate", 'Basic realm="Plumb-All Dashboard"');
    return res.status(401).send("Invalid credentials");
  }

  next();
}

/**
 * Dashboard page
 */
app.get("/dashboard", dashboardAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../assets/dashboard.html"));
});

/**
 * Dashboard: Get current forwarding number
 */
app.get("/dashboard/forwarding", dashboardAuth, async (req, res) => {
  try {
    let trackers = await listTrackers();
    let raw = trackers.length > 0 ? trackers[0].destination_number : null;
    let phone = raw ? normalizePhoneNumber(raw) || raw : null;
    let answeringService = process.env.DASHBOARD_ANSWERING_SERVICE_PHONE_NUMBER
      ? normalizePhoneNumber(
          process.env.DASHBOARD_ANSWERING_SERVICE_PHONE_NUMBER,
        ) || process.env.DASHBOARD_ANSWERING_SERVICE_PHONE_NUMBER
      : null;
    res.json({ phone, answeringService });
  } catch (e) {
    Sentry.captureException(e);
    console.error("Web: Dashboard forwarding fetch error:", e);
    res.status(500).json({ error: "Failed to fetch forwarding number" });
  }
});

/**
 * Dashboard: Update all forwarding numbers
 */
app.post("/dashboard/forwarding", dashboardAuth, async (req, res) => {
  try {
    req.body = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  let phone;
  try {
    phone = toE164(req.body.phone);
  } catch (e) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  try {
    let count = await updateAllTrackerDestinations(phone);
    let friendly = normalizePhoneNumber(phone) || phone;
    res.json({ ok: true, count, phone: friendly });
  } catch (e) {
    Sentry.captureException(e);
    console.error("Web: Dashboard forwarding update error:", e);
    res.status(500).json({ error: "Failed to update forwarding numbers" });
  }
});

/**
 * Dashboard: Submit a contact form (same as answering service)
 */
app.post("/dashboard/contact", dashboardAuth, async (req, res) => {
  try {
    req.body = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  let data = req.body;

  let name = `${data.firstName || ""} ${data.lastName || ""}`.trim();
  let addressParts = [data.street, data.city, data.state, data.zip].filter(
    Boolean,
  );
  let address = addressParts.join(", ") || undefined;

  let contact = new Contact(
    "Call",
    name || undefined,
    data.phone || undefined,
    undefined,
    undefined,
    address,
    data.message || undefined,
    null,
  );

  try {
    await APICoordinator.contactMade(contact, JSON.stringify(data));
    res.json({ ok: true });
  } catch (e) {
    Sentry.captureException(e);
    console.error("Web: Dashboard contact submit error:", e);
    res.status(500).json({ error: "Failed to submit contact" });
  }
});

/**
 * Dashboard: Backfill Google Ads conversion values from CallRail
 */
app.post("/dashboard/backfill-conversions", dashboardAuth, async (req, res) => {
  try {
    console.log("Web: Starting Google Ads conversion backfill");

    let calls = await listCallsWithValueAndGclid();
    let uploaded = 0;
    let skipped = 0;
    let failed = 0;

    // Only process calls within the 55-day adjustment window
    let cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 55);

    for (let call of calls) {
      let callDate = new Date(call.start_time);
      if (callDate < cutoff) {
        skipped++;
        console.log(
          `Web: Backfill skipping call ${call.id} — too old (${call.start_time})`,
        );
        continue;
      }

      try {
        let success = await uploadConversionAdjustment({
          gclid: call.gclid,
          conversionDateTime: call.start_time,
          adjustedValue: parseFloat(call.value),
        });
        if (success) {
          uploaded++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
        console.error(`Web: Backfill failed for call ${call.id}:`, e);
      }
    }

    console.log(
      `Web: Backfill complete — ${uploaded} uploaded, ${skipped} skipped, ${failed} failed out of ${calls.length} total`,
    );
    res.json({ ok: true, total: calls.length, uploaded, skipped, failed });
  } catch (e) {
    Sentry.captureException(e);
    console.error("Web: Backfill error:", e);
    res.status(500).json({ error: "Backfill failed" });
  }
});

app.listen(port, "0.0.0.0", () =>
  console.info(`Web: Node.js server started on port ${port}.`),
);
