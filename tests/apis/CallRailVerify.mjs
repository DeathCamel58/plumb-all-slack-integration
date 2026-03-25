import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsOnMock = jest.fn();
const fetchMock = jest.fn();

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: jest.fn(),
    on: eventsOnMock,
  },
}));

jest.unstable_mockModule("../../util/prismaClient.js", () => ({
  default: {
    invoice: { count: jest.fn() },
  },
}));

jest.unstable_mockModule("node-fetch", () => ({
  default: fetchMock,
}));

jest.unstable_mockModule("../../util/apis/PostHog.js", () => ({
  individualSearch: jest.fn(),
}));

// CallRail docs test vector
const TEST_SIGNING_KEY = "072e77e426f92738a72fe23c4d1953b4";
const TEST_EXPECTED_SIGNATURE = "UZAHbUdfm3GqL7qzilGozGzWV64=";
const TEST_PAYLOAD = `{"answered":false,"business_phone_number":"","call_type":"voicemail","company_id":155920786,"company_name":"Boost Marketing","company_time_zone":"America/Los_Angeles","created_at":"2018-02-19T13:41:00.252-05:00","customer_city":"Rochester","customer_country":"US","customer_name":"Kaylah Mills","customer_phone_number":"+12148654559","customer_state":"PA","device_type":"","direction":"inbound","duration":"13","first_call":false,"formatted_call_type":"Voicemail","formatted_customer_location":"Rochester, PA","formatted_business_phone_number":"","formatted_customer_name":"Kaylah Mills","prior_calls":16,"formatted_customer_name_or_phone_number":"Kaylah Mills","formatted_customer_phone_number":"214-865-4559","formatted_duration":"13s","formatted_tracking_phone_number":"404-555-8514","formatted_tracking_source":"Google Paid","formatted_value":"--","good_lead_call_id":715587840,"good_lead_call_time":"2016-06-17T10:23:33.363-04:00","id":766970532,"lead_status":"previously_marked_good_lead","note":"","recording":"https://app.callrail.com/calls/766970532/recording/redirect?access_key=aaaaccccddddeeee","recording_duration":8,"source_name":"Google AdWords","start_time":"2018-02-19T13:41:00.236-05:00","tags":[],"total_calls":17,"tracking_phone_number":"+14045558514","transcription":"","value":"","voicemail":true,"tracker_id":354024023,"keywords":"","medium":"","referring_url":"","landing_page_url":"","last_requested_url":"","referrer_domain":"","conversational_transcript":"","utm_source":"google","utm_medium":"cpc","utm_term":"","utm_content":"","utm_campaign":"Google AdWords","utma":"","utmb":"","utmc":"","utmv":"","utmz":"","ga":"","gclid":"","integration_data":[{"integration":"Webhooks","data":null}],"keywords_spotted":"","recording_player":"https://app.callrail.com/calls/766970532/recording?access_key=aaaabbbbccccdddd","speaker_percent":"","call_highlights":[],"callercity":"Rochester","callercountry":"US","callername":"Kaylah Mills","callernum":"+12148654559","callerstate":"PA","callsource":"google_paid","campaign":"","custom":"","datetime":"2018-02-19 18:41:00","destinationnum":"","ip":"","kissmetrics_id":"","landingpage":"","referrer":"","referrermedium":"","score":1,"tag":"","trackingnum":"+14045558514","timestamp":"2018-02-19T13:41:00.236-05:00"}`;

process.env.CALLRAIL_API_KEY = "test-api-key";
process.env.CALLRAIL_ACCOUNT_ID = "test-account-id";
process.env.CALLRAIL_SIGNING_KEY = TEST_SIGNING_KEY;
delete process.env.DEBUG;

const { verifyWebhook } = await import("../../util/apis/CallRail.js");

describe("CallRail verifyWebhook", () => {
  test("Valid signature from CallRail docs test vector → returns true", () => {
    const req = {
      headers: { signature: TEST_EXPECTED_SIGNATURE },
      rawBody: TEST_PAYLOAD,
      body: TEST_PAYLOAD,
    };

    expect(verifyWebhook(req)).toBe(true);
  });

  test("Invalid signature → returns false", () => {
    const req = {
      headers: { signature: "bad-signature" },
      rawBody: TEST_PAYLOAD,
      body: TEST_PAYLOAD,
    };

    expect(verifyWebhook(req)).toBe(false);
  });

  test("Missing Signature header → returns false", () => {
    const req = {
      headers: {},
      rawBody: TEST_PAYLOAD,
      body: TEST_PAYLOAD,
    };

    expect(verifyWebhook(req)).toBe(false);
  });

  test("Uses rawBody when available", () => {
    const req = {
      headers: { signature: TEST_EXPECTED_SIGNATURE },
      rawBody: TEST_PAYLOAD,
      body: "this-is-not-the-payload",
    };

    expect(verifyWebhook(req)).toBe(true);
  });
});
