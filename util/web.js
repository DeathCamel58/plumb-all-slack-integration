require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
const express = require('express');
const path = require("path");
const app = express();
let Contact = require('./contact.js');
let { logContact } = require('./posthog.js');

// The port to run the webserver on.
port = 47092;

/**
 * TODO: Add webhooks
 */
app.get('/', (req, res) => {
    res.send("hello world");
})

app.listen( port, "0.0.0.0", () => console.log( `Node.js server started on port ${port}.` ) );
