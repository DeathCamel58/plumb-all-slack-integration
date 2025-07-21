import * as Sentry from "@sentry/node";

// Use sentry if DSN is configured
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    includeLocalVariables: true,
    environment:
      process.env.ENV_LOCATION === "./.env_development"
        ? "development"
        : "production",
    enabled: process.env.NODE_ENV === "production",
  });
}
