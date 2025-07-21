import dotenv from "dotenv";
dotenv.config({
  path: process.env.ENV_LOCATION || "/root/plumb-all-slack-integration/.env",
});

import * as Sentry from "@sentry/node";

// Import modules
const modules = [
  "./util/web.js",
  "./util/apis/86Repairs.js",
  "./util/apis/CloudFlareWorkers.js",
  "./util/apis/FleetSharp.js",
  "./util/apis/GoogleAds.js",
  "./util/apis/instrument.js",
  "./util/apis/JobberWebHookHandler.js",
  "./util/apis/Mailchimp.js",
  "./util/apis/Mattermost.js",
  "./util/apis/Postgres.js",
  "./util/apis/SasoWebHookHandler.js",
  "./util/apis/SlackBot.js",
  "./util/apis/VerisaeIngles.js",
  "./util/apis/WebsiteContact.js",
];
for (let i = 0; i < modules.length; i++) {
  try {
    let tmp = import(modules[i]);
  } catch (e) {
    console.error("Application Index: Failure importing module: " + e);
    Sentry.captureException(e);
  }
}
