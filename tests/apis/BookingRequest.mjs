import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const createServiceRequestMock = jest.fn();
const contactMadeMock = jest.fn();

jest.unstable_mockModule("../../util/events.js", () => ({
  default: { emit: eventsEmitMock, on: jest.fn() },
}));

jest.unstable_mockModule("../../util/APICoordinator.js", () => ({
  contactMade: contactMadeMock,
}));

jest.unstable_mockModule("../../util/apis/Jobber.js", () => ({
  createServiceRequest: createServiceRequestMock,
}));

const {
  agentLabel,
  handleBookingRequest,
  isNotServiceRequest,
  looksLikeEmergency,
  parseAddress,
  resetBookingState,
} = await import("../../util/apis/BookingRequest.js");

let phoneCounter = 0;
let addressCounter = 0;

/** A valid body, with a fresh phone and address so limits don't collide */
function validBody(overrides = {}) {
  phoneCounter++;
  addressCounter++;
  return {
    name: "Jane Smith",
    phone: `+1770${String(2000000 + phoneCounter)}`,
    address: `${100 + addressCounter} Main St, Stockbridge, GA 30281`,
    service_category: "plumbing",
    service: "water_heater",
    description: "The water heater in the garage is leaking from the bottom.",
    sms_consent: true,
    service_area_confirmed: true,
    acting_on_behalf_of_customer: true,
    source: "TestAgent",
    ...overrides,
  };
}

let ipCounter = 0;
const freshIp = () => `10.0.0.${++ipCounter}`;

beforeEach(() => {
  jest.clearAllMocks();
  resetBookingState();
  createServiceRequestMock.mockResolvedValue({
    requestId: "REQ123",
    clientId: "CLI123",
    url: "https://secure.getjobber.com/requests/1",
  });
});

describe("handleBookingRequest", () => {
  test("a valid request creates a Jobber request and tells staff", async () => {
    const body = validBody();
    const { httpStatus, body: result } = await handleBookingRequest(
      body,
      freshIp(),
    );

    expect(httpStatus).toBe(201);
    expect(result.status).toBe("received");
    expect(result.request_id).toBe("REQ123");
    expect(result.urgent).toBeUndefined();
    expect(createServiceRequestMock).toHaveBeenCalledTimes(1);
    const args = createServiceRequestMock.mock.calls[0][0];
    expect(args.phone).toBe(body.phone);
    expect(args.smsAllowed).toBe(true);
    expect(args.address).toEqual({
      street1: body.address.split(",")[0],
      city: "Stockbridge",
      province: "GA",
      postalCode: "30281",
    });
    expect(args.note).toContain("TestAgent");
    expect(args.note).not.toContain("30 miles");
    const [contact] = contactMadeMock.mock.calls[0];
    expect(contact.message).not.toContain("TestAgent");
    expect(contact.message).not.toContain("30 miles");
    expect(contact.source).toBe("AI Agent");
    expect(contactMadeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "AI Agent Booking Request" }),
      expect.any(String),
    );
    expect(args.title).toBe(
      "AI agent request (TestAgent): plumbing - water heater",
    );
    expect(args.sourceText).toBe("AI agent: TestAgent");
  });

  test("normalizes the phone to E.164", async () => {
    await handleBookingRequest(
      validBody({ phone: "(770) 234-5678" }),
      freshIp(),
    );
    expect(createServiceRequestMock.mock.calls[0][0].phone).toBe(
      "+17702345678",
    );
  });

  test.each([
    ["service_area_confirmed", false],
    ["service_area_confirmed", undefined],
    ["acting_on_behalf_of_customer", false],
    ["sms_consent", undefined],
    ["service_category", "hvac"],
    ["description", ""],
    ["phone", "123"],
    ["phone", "(770) 555-0123"],
    ["address", "somewhere in Georgia"],
    ["email", "not-an-email"],
    ["preferred_window", { date: "tomorrow", period: "morning" }],
  ])("%s = %p is rejected with a per-field 422", async (field, value) => {
    const body = validBody({ [field]: value });
    if (value === undefined) delete body[field];
    const { httpStatus, body: result } = await handleBookingRequest(
      body,
      freshIp(),
    );

    expect(httpStatus).toBe(422);
    expect(result.status).toBe("invalid_request");
    expect(result.errors[field]).toBeDefined();
    expect(createServiceRequestMock).not.toHaveBeenCalled();
    expect(contactMadeMock).not.toHaveBeenCalled();
  });

  test("rejects unknown fields", async () => {
    const { httpStatus, body } = await handleBookingRequest(
      validBody({ coupon: "FREE" }),
      freshIp(),
    );
    expect(httpStatus).toBe(422);
    expect(body.errors.coupon).toBe("Unknown field.");
  });

  test("a solicitation gets not_a_service_request and reaches nothing", async () => {
    const { httpStatus, body } = await handleBookingRequest(
      validBody({
        description:
          "We would like to buy your business. Please reply with your asking price.",
      }),
      freshIp(),
    );

    expect(httpStatus).toBe(200);
    expect(body.status).toBe("not_a_service_request");
    expect(body.message).toContain("(770) 914-3877");
    expect(createServiceRequestMock).not.toHaveBeenCalled();
    expect(contactMadeMock).not.toHaveBeenCalled();
  });

  test("an emergency is flagged urgent and returns the phone number", async () => {
    const { httpStatus, body } = await handleBookingRequest(
      validBody({
        description: "A pipe burst under the sink and water is everywhere.",
      }),
      freshIp(),
    );

    expect(httpStatus).toBe(201);
    expect(body.urgent).toBe(true);
    expect(body.message).toContain("call");
    expect(body.emergency_phone).toBe("+1-770-914-3877");
    expect(createServiceRequestMock.mock.calls[0][0].title).toMatch(/^URGENT/);
    expect(contactMadeMock.mock.calls[0][0].type).toMatch(/^URGENT/);
  });

  test("is_emergency flags it urgent too", async () => {
    const { body } = await handleBookingRequest(
      validBody({ is_emergency: true }),
      freshIp(),
    );
    expect(body.urgent).toBe(true);
  });

  test("the same idempotency key returns the original result and creates nothing new", async () => {
    const body = validBody({ idempotency_key: "abc-123" });
    const first = await handleBookingRequest(body, freshIp());
    const second = await handleBookingRequest(body, freshIp());

    expect(second).toEqual(first);
    expect(createServiceRequestMock).toHaveBeenCalledTimes(1);
    expect(contactMadeMock).toHaveBeenCalledTimes(1);
  });

  test("the same phone again is a duplicate", async () => {
    const body = validBody();
    await handleBookingRequest(body, freshIp());
    const { httpStatus, body: result } = await handleBookingRequest(
      { ...body, address: "999 Other Rd, Stockbridge, GA 30281" },
      freshIp(),
    );

    expect(httpStatus).toBe(200);
    expect(result.status).toBe("duplicate");
    expect(createServiceRequestMock).toHaveBeenCalledTimes(1);
  });

  test("the same address again is a duplicate", async () => {
    const body = validBody();
    await handleBookingRequest(body, freshIp());
    const { body: result } = await handleBookingRequest(
      validBody({ address: body.address }),
      freshIp(),
    );

    expect(result.status).toBe("duplicate");
  });

  test("a sixth request from one IP in an hour is rate limited", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      const { httpStatus } = await handleBookingRequest(validBody(), ip);
      expect(httpStatus).toBe(201);
    }
    const { httpStatus, body } = await handleBookingRequest(validBody(), ip);

    expect(httpStatus).toBe(429);
    expect(body.status).toBe("rate_limited");
  });

  test("a third try for one phone in a day is rate limited", async () => {
    const body = validBody();
    await handleBookingRequest(body, freshIp());
    await handleBookingRequest(body, freshIp());
    const { httpStatus } = await handleBookingRequest(body, freshIp());

    expect(httpStatus).toBe(429);
  });

  test("a Jobber failure alerts staff, returns error, and can be retried", async () => {
    createServiceRequestMock.mockRejectedValueOnce(new Error("Jobber down"));
    const body = validBody({ idempotency_key: "retry-me" });

    const failed = await handleBookingRequest(body, freshIp());
    expect(failed.httpStatus).toBe(500);
    expect(failed.body.status).toBe("error");
    expect(contactMadeMock).toHaveBeenCalledTimes(1);
    expect(contactMadeMock.mock.calls[0][0].message).toContain("could NOT");

    const retried = await handleBookingRequest(body, freshIp());
    expect(retried.httpStatus).toBe(201);
  });
});

describe("agentLabel", () => {
  test.each([
    ["claude-desktop", "Claude"],
    ["Anthropic Claude Code", "Claude"],
    ["ChatGPT", "OpenAI"],
    ["openai-agent", "OpenAI"],
    ["Gemini Assistant", "Gemini"],
    ["Perplexity", "Perplexity"],
    ["AcmeBot", "AcmeBot"],
  ])("%s is %s", (source, label) => {
    expect(agentLabel(source)).toBe(label);
  });

  test("no source is unknown", () => {
    expect(agentLabel(null)).toBe("unknown");
  });
});

describe("isNotServiceRequest", () => {
  test.each([
    "We offer SEO and backlinks to rank your site higher on Google.",
    "Hi, I'm interested in a partnership or collaboration with your company.",
    "I am looking for a job. Please see my resume.",
    "We provide commercial cleaning for offices like yours.",
    "We are an investor interested in an acquisition opportunity.",
  ])("screens out: %s", (text) => {
    expect(isNotServiceRequest(text)).toBe(true);
  });

  test.each([
    "Kitchen sink is clogged and the garbage disposal hums.",
    "Need the septic tank pumped, it is 5 years since the last time.",
    "Looking for a collaboration on a leaky pipe repair, please call back.",
    "Toilet keeps running. Do you offer web scheduling?",
  ])("lets through: %s", (text) => {
    expect(isNotServiceRequest(text)).toBe(false);
  });
});

describe("looksLikeEmergency", () => {
  test.each([
    "burst pipe in the basement",
    "sewage is backing up into the house",
    "we have no water at all",
    "I smell gas near the water heater",
  ])("flags: %s", (text) => {
    expect(looksLikeEmergency(text)).toBe(true);
  });

  test("does not flag a routine job", () => {
    expect(looksLikeEmergency("Faucet drips a little at night")).toBe(false);
  });
});

describe("parseAddress", () => {
  test("splits street, city, state and ZIP", () => {
    expect(
      parseAddress("218 N McDonough St, Jonesboro, GA 30236-1234"),
    ).toEqual({
      street1: "218 N McDonough St",
      city: "Jonesboro",
      province: "GA",
      postalCode: "30236",
    });
  });

  test("returns null for an address without city, state and ZIP", () => {
    expect(parseAddress("218 N McDonough St")).toBeNull();
  });
});
