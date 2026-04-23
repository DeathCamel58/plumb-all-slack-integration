# plumb-all-slack-integration

Internal integration hub for [Plumb-All](https://plumb-all.com). Connects Jobber, Twilio, CallRail, Slack, Mattermost, Google Ads, PostHog, and other services through a central Express server and event system.

## Integrations

- **[Jobber](https://getjobber.com)** -- Webhooks for clients, requests, quotes, jobs, invoices, payments, expenses, visits, and timesheets. Events are forwarded to PostHog, Slack, Mattermost, and Trello.
- **[Twilio](https://twilio.com)** -- Inbound/outbound call routing, recording, voicemail, phone number management, and SMS.
- **[CallRail](https://callrail.com)** -- Call tracking, lead qualification, first-invoice conversion attribution. Webhooks trigger Google Ads conversion adjustments when calls have value and a GCLID.
- **[Slack](https://slack.com)** -- Contact cards in `#calls`, interactive actions (outbound calls, send-to-contact, reactions update Trello), slash commands.
- **[Mattermost](https://mattermost.com)** -- WebSocket messaging, automatic Jobber reference linking (Quote/Job/Invoice #).
- **[Google Ads](https://ads.google.com)** -- Conversion value adjustments via the REST API, lead form webhooks.
- **[PostHog](https://posthog.com)** -- Contact and event analytics. Tracks clients, requests, quotes, jobs, invoices, expenses, and visits. Merges identities across Twilio, Jobber, and CallRail.
- **[Mailchimp](https://mailchimp.com)** -- Marketing events on invoice create/update.
- **[Trello](https://trello.com)** -- Contact cards created/moved based on Slack reactions.
- **[FleetSharp](https://fleetsharp.com)** -- Vehicle alerts (speeding, harsh braking, geofence, idle) sent to Slack.
- **[Deepgram](https://deepgram.com)** -- Speech-to-text transcription for call recordings.
- **[OpenAI](https://openai.com)** -- AI-powered call summarization and analysis.
- **[Sentry](https://sentry.io)** -- Error monitoring and exception tracking.
- **[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)** -- Bot protection for website contact and feedback forms.

## Setup

Requires Node.js >= 22 and PostgreSQL.

```sh
npm install
npx prisma generate
cp .env_example .env_production  # or .env_development
# Fill in the env file with your credentials
npm start
```

## Testing

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js
```

The `test:ci` npm script runs the same command with CI reporters.

## Example `.env` file

```dotenv
# Slack
SLACK_CHANNEL=calls
SLACK_CALL_LOGS=call-logs
SLACK_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your-slack-signing-secret
SLACK_CHANNEL_GENERAL=general
SLACK_ANALYZE_EPHEMERAL=TRUE

# Mattermost
MATTERMOST_CHANNEL=channel-name
MATTERMOST_URL=https://mattermost.example.com
MATTERMOST_TOKEN=your-mattermost-token
MATTERMOST_WEBHOOK_OPEN_JOBS_TOKEN=your-webhook-token
MATTERMOST_CHANNEL_GENERAL=town-square

# Jobber
JOBBER_CLIENT_ID=your-jobber-client-id
JOBBER_APP_SECRET=your-jobber-app-secret
JOBBER_AUTHORIZATION_CODE=your-jobber-auth-code
JOBBER_REFRESH_TOKEN=your-jobber-refresh-token

# Google Ads
GOOGLE_ADS_KEY=your-google-ads-key
GOOGLE_ADS_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
GOOGLE_ADS_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_ADS_REFRESH_TOKEN=your-oauth-refresh-token
GOOGLE_ADS_DEVELOPER_TOKEN=your-developer-token
GOOGLE_ADS_LOGIN_CUSTOMER_ID=1234567890
GOOGLE_ADS_CUSTOMER_ID=1234567890
GOOGLE_ADS_CONVERSION_ACTION_ID=customers/1234567890/conversionActions/1234567890

# Google Maps
GOOGLE_API_KEY=your-google-maps-api-key

# PostHog
POSTHOG_HOST=https://app.posthog.com
POSTHOG_TOKEN=phc_your-posthog-token
POSTHOG_API_TOKEN=phx_your-posthog-api-token
POSTHOG_PROJECT_ID=12345

# Trello
TRELLO_API_KEY=your-trello-api-key
TRELLO_TOKEN=your-trello-token
TRELLO_BOARD_NAME=Calls
TRELLO_LIST_NAME_TODO=To Do
TRELLO_LIST_NAME_WIP=Doing
TRELLO_LIST_NAME_DONE=Done
TRELLO_LIST_NAME_NO_GO=No Go

# Twilio
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_FALLBACK_NUMBER=your-fallback-number

# CallRail
CALLRAIL_API_KEY=your-callrail-api-key
CALLRAIL_ACCOUNT_ID=your-callrail-account-id
CALLRAIL_SIGNING_KEY=your-callrail-signing-key
# Set to TRUE to disable all CallRail API calls (webhooks still process)
# CALLRAIL_API_DISABLED=TRUE

# Mailchimp
MAILCHIMP_API_KEY=your-mailchimp-api-key-us19
MAILCHIMP_LIST_ID=your-mailchimp-list-id

# OpenAI
OPENAI_API_KEY=sk-your-openai-key
OPENAI_MODEL=gpt-4o

# Deepgram
DEEPGRAM_API_KEY=your-deepgram-api-key

# Cloudflare Turnstile
CLOUDFLARE_CONTACT_FORM_KEY=your-turnstile-secret-key

# reCAPTCHA
RECAPTCHA_SECRET_KEY=your-recaptcha-secret-key
RECAPTCHA_SCORE_THRESHOLD=0.7

# Sentry
SENTRY_DSN=https://your-key@your-org.ingest.us.sentry.io/your-project-id

# Database
DB_URL=postgresql://user:password@localhost:5432/dbname

# Web
WEB_URL=https://your-public-url.com
WEB_PORT=80
DASHBOARD_KEY=your-dashboard-key
DASHBOARD_ANSWERING_SERVICE_PHONE_NUMBER=+11234567890

DEBUG=FALSE
```
