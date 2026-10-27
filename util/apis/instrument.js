import * as Sentry from "@sentry/node";

// Use sentry if DSN is configured
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    includeLocalVariables: true,
    environment:
      process.env.ENV_LOCATION === "./.env_development"
        ? "development"
        : "production",
    enabled: process.env.NODE_ENV === "production",
    // v11 collects request bodies, cookies and user info unless told not to.
    // Webhook bodies carry customer names, phones and addresses, so keep the
    // v10 defaults (the baseline from Sentry's v11 migration guide).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
        response: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      },
      httpBodies: [],
      urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
    },
    // v11 attaches a stack trace to captureMessage, which would regroup the
    // existing message issues
    attachStacktrace: false,
  });
}
