require("./util/web");

// Require files to allow them to register events
const files = [
  "./util/apis/CloudFlareWorkers",
  "./util/apis/FleetSharp",
  "./util/apis/GoogleAds",
  "./util/apis/JobberWebHookHandler",
  "./util/apis/SasoWebHookHandler",
  "./util/apis/VerisaeIngles",
  "./util/apis/WebsiteContact",
];
for (let i = 0; i < files.length; i++) {
  let tmp = require(files[i]);
}

// Import modules
const modules = ["./util/apis/Mattermost.mjs"];
for (let i = 0; i < modules.length; i++) {
  let tmp = import(modules[i]);
}
