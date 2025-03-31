require("dotenv").config({
  path: process.env.ENV_LOCATION || "/root/plumb-all-slack-integration/.env",
});
const Sentry = require("@sentry/node");

// Use sentry if DSN is configured
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    includeLocalVariables: true,
    environment:
      process.env.ENV_LOCATION === "./.env_development"
        ? "development"
        : "production",
  });
}
