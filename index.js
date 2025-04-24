require("./util/apis/instrument");
const Sentry = require("@sentry/node");

// Require files to allow them to register events
const files = [
  "./util/web",
  "./util/apis/CloudFlareWorkers",
  "./util/apis/FleetSharp",
  "./util/apis/GoogleAds",
  "./util/apis/JobberWebHookHandler",
  "./util/apis/SasoWebHookHandler",
  "./util/apis/VerisaeIngles",
  "./util/apis/WebsiteContact",
  "./util/apis/86Repairs",
];
for (let i = 0; i < files.length; i++) {
  try {
    let tmp = require(files[i]);
  } catch (e) {
    console.error("Application Index: Failure importing file: " + e);
    Sentry.captureException(e);
  }
}

// Import modules
const modules = ["./util/apis/Mattermost.mjs"];
for (let i = 0; i < modules.length; i++) {
  try {
    let tmp = import(modules[i]);
  } catch (e) {
    console.error("Application Index: Failure importing module: " + e);
    Sentry.captureException(e);
  }
}
