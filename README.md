# Plumb-All's Slack integration

This is an internal integration tool that [Plumb-All](https://plumb-all.com) uses to integrate various things.

## Custom integrations

- [Jobber](https://getjobber.com)
  - New clients, invoices, quotes, jobs, etc get sent to [PostHog](https://posthog.com)
  - New requests in Jobber get sent into Slack, PostHog, and Trello
- [Google Ads](https://ads.google.com)
  - Lead forms are sent to Slack, PostHog, and Trello
- [Slack](https://slack.com)
  - Reactions to contacts in Slack update Trello
- [FleetSharp](https://fleetsharp.com)
  - Sends certain vehicle alerts to Slack

## Example `.env` file

```dotenv
# Email Connection information
EMAIL_ADDRESS=email@address.com
EMAIL_CHECK_INTERVAL=[milliseconds for email check interval]

# Slack App Credentials
SLACK_CHANNEL=slack-channel-name
SLACK_TOKEN=xoxb-6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
SLACK_SIGNING_SECRET=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
SLACK_USER_ID=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c

# Mattermost App Credentials
MATTERMOST_CHANNEL=mattermost-channel-name
MATTERMOST_URL=https://mattermost.example.com
MATTERMOST_TOKEN_ID=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
MATTERMOST_TOKEN=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
MATTERMOST_USERNAME=mattermost-username
MATTERMOST_SLASH_COMMAND_TOKEN=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c

# Google Ads Key
GOOGLE_ADS_KEY=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
# Google API Key
GOOGLE_API_KEY=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c

# Jobber App Credentials
JOBBER_CLIENT_ID=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
JOBBER_APP_SECRET=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
JOBBER_AUTHORIZATION_CODE=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
JOBBER_REFRESH_TOKEN=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c

# Posthog Credentials
POSTHOG_HOST=https://app.posthog.com
POSTHOG_TOKEN=phc_6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
POSTHOG_API_TOKEN=phx_6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
POSTHOG_PROJECT_ID=12345

# Trello Settings
TRELLO_API_KEY=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
TRELLO_SECRET=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
TRELLO_TOKEN=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
TRELLO_BOARD_NAME=name-of-trello-board
TRELLO_LIST_NAME_TODO=name-of-trello-todo-list
TRELLO_LIST_NAME_WIP=name-of-trello-wip-list
TRELLO_LIST_NAME_DONE=name-of-trello-done-list
TRELLO_LIST_NAME_NO_GO=name-of-trello-no-go-list

# Facebook Settings
FACEBOOK_KEY=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
FACEBOOK_APP_ID=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
FACEBOOK_APP_SECRET=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c
FACEBOOK_ACCESS_TOKEN=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c

# CloudFlare Keys
CLOUDFLARE_CONTACT_FORM_KEY=6c6d60e7-dc09-4b1d-b780-8ddc50a61e4c

# Web Stuff
WEB_URL=https://publicly.accessable.url
WEB_PORT=80

DEBUG=FALSE
```
