require('./util/web');

// Require files to allow them to register events
const files = [
    './util/apis/CloudFlareWorkers',
    './util/apis/FleetSharp',
    './util/apis/GoogleAds',
    './util/apis/JobberWebHookHandler',
    './util/apis/SasoWebHookHandler'
];
for (let i = 0; i < files.length; i++) {
    let tmp = require(files[i]);
}
