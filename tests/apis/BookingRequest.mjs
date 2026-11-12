import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const createServiceRequestMock = jest.fn();
const contactMadeMock = jest.fn();
const hostBookingImagesMock = jest.fn();
const addRequestNoteMock = jest.fn();
const getRequestForUpdateMock = jest.fn();
const getRequestAttachmentNamesMock = jest.fn();
const deleteReusableFileMock = jest.fn();
const hostPhotoMock = jest.fn();

jest.unstable_mockModule("../../util/events.js", () => ({
  default: { emit: eventsEmitMock, on: jest.fn() },
}));

jest.unstable_mockModule("../../util/APICoordinator.js", () => ({
  contactMade: contactMadeMock,
}));

jest.unstable_mockModule("../../util/apis/BookingImages.js", () => ({
  hostBookingImages: hostBookingImagesMock,
  hostPhoto: hostPhotoMock,
  MAX_IMAGE_BYTES: 8 * 1024 * 1024,
  sniffImageType: (b) => (b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : null),
}));

jest.unstable_mockModule("../../util/mediaStore.js", () => ({
  deleteReusableFile: deleteReusableFileMock,
}));

jest.unstable_mockModule("../../util/apis/Jobber.js", () => ({
  createServiceRequest: createServiceRequestMock,
  addRequestNote: addRequestNoteMock,
  getRequestForUpdate: getRequestForUpdateMock,
  getRequestAttachmentNames: getRequestAttachmentNamesMock,
}));

const {
  agentLabel,
  handleBookingAddition,
  handleBookingPhoto,
  handleBookingRequest,
  issueUpdateToken,
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
  process.env.BOOKING_UPDATE_SECRET = "test-secret";
  process.env.WEB_URL = "https://integration.example";
  addRequestNoteMock.mockResolvedValue({ attached: true });
  getRequestAttachmentNamesMock.mockResolvedValue(["photo-1-abc123.jpg"]);
  hostPhotoMock.mockReturnValue({
    url: "https://integration.example/media/tok1/photo-1-abc123.jpg",
    token: "tok1",
    filename: "photo-1-abc123.jpg",
    image: { buffer: Buffer.from("img"), filename: "photo-1-abc123.jpg" },
  });
  getRequestForUpdateMock.mockResolvedValue({
    title: "AI agent request (Claude): plumbing",
    status: "NEW",
    url: "https://secure.getjobber.com/requests/1",
    name: "Jane Smith",
    phone: "(770) 234-5678",
    address: "1 Main St, Stockbridge, GA 30281",
  });
  createServiceRequestMock.mockResolvedValue({
    requestId: "REQ123",
    clientId: "CLI123",
    url: "https://secure.getjobber.com/requests/1",
    attached: true,
  });
  hostBookingImagesMock.mockImplementation(async (links) => ({
    tokens: links.map((l, i) => `tok${i}`),
    filenames: links.map((l, i) => `photo-${i + 1}-abc123.jpg`),
    images: links.map((l, i) => ({
      buffer: Buffer.from("img"),
      filename: `photo-${i + 1}.jpg`,
      sourceUrl: l,
    })),
    failedLinks: [],
    urls: links.map(
      (l, i) => `https://hosted.example/media/t${i}/photo-${i + 1}.jpg`,
    ),
    failed: 0,
  }));
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

  test("fills the Jobber service details form and carries the extra context", async () => {
    const body = validBody({
      additional_context:
        "No hot water since Monday. Breaker and gas valve already checked.",
    });
    await handleBookingRequest(body, freshIp());

    const args = createServiceRequestMock.mock.calls[0][0];
    expect(args.details).toEqual([
      {
        label: "Please provide as much information as you can",
        answerText: body.description,
      },
      {
        label:
          "Additional context from the AI agent (symptoms, diagnostics already done)",
        answerText: body.additional_context,
      },
      {
        label: "How did you hear about us?",
        answerText: "AI agent: TestAgent",
      },
    ]);
    expect(args.note).toContain("Breaker and gas valve already checked");
    expect(contactMadeMock.mock.calls[0][0].message).toContain(
      "Breaker and gas valve already checked",
    );
  });

  test("without extra context the form has just the description and source", async () => {
    await handleBookingRequest(validBody(), freshIp());

    const { details } = createServiceRequestMock.mock.calls[0][0];
    expect(details.map((d) => d.label)).toEqual([
      "Please provide as much information as you can",
      "How did you hear about us?",
    ]);
  });

  test("photo links go to the form item, the note and Slack", async () => {
    const urls = ["https://example.com/a.jpg", "https://cdn.example.org/b.png"];
    await handleBookingRequest(validBody({ image_urls: urls }), freshIp());

    const args = createServiceRequestMock.mock.calls[0][0];
    expect(
      args.details.find(
        (d) => d.label === "Share images of the work to be done",
      ).answerText,
    ).toBe("In notes");
    expect(args.note).toContain(urls[1]);
    expect(hostBookingImagesMock).toHaveBeenCalledWith(urls);
    expect(args.attachmentUrls).toEqual([
      "https://hosted.example/media/t0/photo-1.jpg",
      "https://hosted.example/media/t1/photo-2.jpg",
    ]);
    // Downloaded photos are attached in Slack, not linked
    const contact = contactMadeMock.mock.calls[0][0];
    expect(contact.images.map((i) => i.filename)).toEqual([
      "photo-1.jpg",
      "photo-2.jpg",
    ]);
    expect(contact.message).not.toContain(urls[0]);
  });

  test.each([
    ["http link", ["http://example.com/a.jpg"]],
    ["not a link", ["a photo"]],
    ["localhost", ["https://localhost/a.jpg"]],
    ["IP address", ["https://10.0.0.5/a.jpg"]],
    ["credentials", ["https://user:pw@example.com/a.jpg"]],
    ["not a list", "https://example.com/a.jpg"],
    [
      "too many",
      Array.from({ length: 6 }, (_, i) => `https://example.com/${i}.jpg`),
    ],
  ])("image_urls with %s is rejected", async (_label, image_urls) => {
    const { httpStatus, body } = await handleBookingRequest(
      validBody({ image_urls }),
      freshIp(),
    );
    expect(httpStatus).toBe(422);
    expect(body.errors.image_urls).toBeDefined();
  });

  test("reports how many photos were attached", async () => {
    const { body } = await handleBookingRequest(
      validBody({ image_urls: ["https://example.com/a.jpg"] }),
      freshIp(),
    );
    expect(body.images_attached).toBe(1);
  });

  test("a photo that could not be downloaded stays a link in Slack", async () => {
    hostBookingImagesMock.mockResolvedValue({
      urls: [],
      images: [],
      failedLinks: ["https://example.com/gone.jpg"],
    });
    await handleBookingRequest(
      validBody({ image_urls: ["https://example.com/gone.jpg"] }),
      freshIp(),
    );
    expect(contactMadeMock.mock.calls[0][0].message).toContain(
      "https://example.com/gone.jpg",
    );
  });

  test("a request without photos has no images_attached and downloads nothing", async () => {
    const { body } = await handleBookingRequest(validBody(), freshIp());
    expect(body.images_attached).toBeUndefined();
    expect(hostBookingImagesMock).not.toHaveBeenCalled();
  });

  test("photos that could not be attached report zero but the request succeeds", async () => {
    hostBookingImagesMock.mockResolvedValue({
      urls: [],
      images: [],
      failedLinks: ["https://example.com/a.jpg"],
    });
    createServiceRequestMock.mockResolvedValue({
      requestId: "REQ123",
      clientId: "CLI123",
      url: null,
      attached: false,
    });
    const { httpStatus, body } = await handleBookingRequest(
      validBody({ image_urls: ["https://example.com/a.jpg"] }),
      freshIp(),
    );
    expect(httpStatus).toBe(201);
    expect(body.images_attached).toBe(0);
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
    expect(body.message).toContain("straight to Plumb-All dispatch");
    expect(body.message).not.toMatch(/call now|fastest/i);
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

describe("201 response carries what is needed to add to the request", () => {
  test("update_token, update_url and a note about photos", async () => {
    const { body } = await handleBookingRequest(validBody(), freshIp());
    expect(body.update_token).toBe(issueUpdateToken("REQ123"));
    expect(body.update_url).toBe(
      "https://integration.example/website/bookingRequest/REQ123/additions",
    );
    expect(body.update_note).toContain("photos");
  });

  test("no secret means no token is issued", async () => {
    delete process.env.BOOKING_UPDATE_SECRET;
    delete process.env.JOBBER_APP_SECRET;
    const { body } = await handleBookingRequest(validBody(), freshIp());
    expect(body.update_token).toBeUndefined();
  });
});

describe("handleBookingAddition", () => {
  const token = () => issueUpdateToken("REQ123");

  test("adds a note with the photos and tells staff in Slack only", async () => {
    const { httpStatus, body } = await handleBookingAddition(
      "REQ123",
      {
        update_token: token(),
        additional_context: "Water meter dial moves with everything off.",
        image_urls: ["https://example.com/meter.jpg"],
      },
      freshIp(),
    );

    expect(httpStatus).toBe(200);
    expect(body).toMatchObject({ status: "updated", images_attached: 1 });
    const note = addRequestNoteMock.mock.calls[0][0];
    expect(note.requestId).toBe("REQ123");
    expect(note.note).toContain("Water meter dial moves");
    expect(note.note).toContain("https://example.com/meter.jpg");
    expect(note.attachmentUrls).toHaveLength(1);
    expect(eventsEmitMock).toHaveBeenCalledWith(
      "slackbot-send-booking-update",
      expect.objectContaining({
        jobberUrl: "https://secure.getjobber.com/requests/1",
        text: expect.stringContaining("Water meter dial moves"),
        images: expect.any(Array),
        fallbackContact: expect.objectContaining({
          type: "AI Agent Booking Update",
        }),
      }),
    );
    // Not a new contact: no Trello card or PostHog event
    expect(contactMadeMock).not.toHaveBeenCalled();
  });

  test("a wrong token and an unknown request look the same", async () => {
    const wrong = await handleBookingAddition(
      "REQ123",
      { update_token: "nope", additional_context: "x" },
      freshIp(),
    );
    const otherRequest = await handleBookingAddition(
      "REQ999",
      { update_token: token(), additional_context: "x" },
      freshIp(),
    );

    expect(wrong.httpStatus).toBe(404);
    expect(otherRequest).toEqual(wrong);
    expect(addRequestNoteMock).not.toHaveBeenCalled();
    expect(getRequestForUpdateMock).not.toHaveBeenCalled();
  });

  test("a request the booking API didn't make is not found", async () => {
    getRequestForUpdateMock.mockResolvedValue({
      title: "Kitchen remodel",
      status: "new",
    });
    const { httpStatus } = await handleBookingAddition(
      "REQ123",
      { update_token: token(), additional_context: "x" },
      freshIp(),
    );
    expect(httpStatus).toBe(404);
    expect(addRequestNoteMock).not.toHaveBeenCalled();
  });

  test("a request staff already moved on is no longer editable", async () => {
    getRequestForUpdateMock.mockResolvedValue({
      title: "AI agent request (Claude): plumbing",
      status: "ASSESSMENT_SCHEDULED",
    });
    const { httpStatus, body } = await handleBookingAddition(
      "REQ123",
      { update_token: token(), additional_context: "x" },
      freshIp(),
    );
    expect(httpStatus).toBe(409);
    expect(body.status).toBe("no_longer_editable");
    expect(addRequestNoteMock).not.toHaveBeenCalled();
  });

  test.each([
    ["nothing to add", {}],
    ["unknown field", { additional_context: "x", status: "closed" }],
    ["bad photo link", { image_urls: ["http://example.com/a.jpg"] }],
  ])("%s is a 422", async (_label, extra) => {
    const { httpStatus } = await handleBookingAddition(
      "REQ123",
      { update_token: token(), ...extra },
      freshIp(),
    );
    expect(httpStatus).toBe(422);
  });

  test("a missing token is a 422", async () => {
    const { httpStatus, body } = await handleBookingAddition(
      "REQ123",
      { additional_context: "x" },
      freshIp(),
    );
    expect(httpStatus).toBe(422);
    expect(body.errors.update_token).toBeDefined();
  });

  test("the same idempotency key adds only once", async () => {
    const input = {
      update_token: token(),
      additional_context: "x",
      idempotency_key: "k1",
    };
    const first = await handleBookingAddition("REQ123", input, freshIp());
    const second = await handleBookingAddition("REQ123", input, freshIp());
    expect(second).toEqual(first);
    expect(addRequestNoteMock).toHaveBeenCalledTimes(1);
  });

  test("an eleventh update in a day is rate limited", async () => {
    for (let i = 0; i < 10; i++) {
      const { httpStatus } = await handleBookingAddition(
        "REQ123",
        { update_token: token(), additional_context: `n${i}` },
        freshIp(),
      );
      expect(httpStatus).toBe(200);
    }
    const { httpStatus } = await handleBookingAddition(
      "REQ123",
      { update_token: token(), additional_context: "one more" },
      freshIp(),
    );
    expect(httpStatus).toBe(429);
  });

  test("without a secret updates are unavailable", async () => {
    const t = token();
    delete process.env.BOOKING_UPDATE_SECRET;
    delete process.env.JOBBER_APP_SECRET;
    const { httpStatus } = await handleBookingAddition(
      "REQ123",
      { update_token: t, additional_context: "x" },
      freshIp(),
    );
    expect(httpStatus).toBe(503);
  });
});

const flush = () => new Promise((resolve) => setImmediate(resolve));
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.alloc(32),
]);

describe("temporary photo copies are dropped once Jobber has them", () => {
  test("a photo link on a new request is released after Jobber attaches it", async () => {
    getRequestAttachmentNamesMock.mockResolvedValue(["photo-1-abc123.jpg"]);
    await handleBookingRequest(
      validBody({ image_urls: ["https://example.com/a.jpg"] }),
      freshIp(),
    );
    await flush();
    expect(deleteReusableFileMock).toHaveBeenCalledWith("tok0");
  });

  test("copies are dropped at once when Jobber would not take the photos", async () => {
    createServiceRequestMock.mockResolvedValue({
      requestId: "REQ123",
      clientId: "CLI123",
      url: null,
      attached: false,
    });
    await handleBookingRequest(
      validBody({ image_urls: ["https://example.com/a.jpg"] }),
      freshIp(),
    );
    expect(deleteReusableFileMock).toHaveBeenCalledWith("tok0");
    expect(getRequestAttachmentNamesMock).not.toHaveBeenCalled();
  });

  test("copies are dropped when the request can't be created", async () => {
    createServiceRequestMock.mockRejectedValue(new Error("Jobber down"));
    await handleBookingRequest(
      validBody({ image_urls: ["https://example.com/a.jpg"] }),
      freshIp(),
    );
    expect(deleteReusableFileMock).toHaveBeenCalledWith("tok0");
  });
});

describe("handleBookingPhoto", () => {
  const token = () => issueUpdateToken("REQ123");

  test("attaches the uploaded photo, posts it to Slack, then drops it from memory", async () => {
    const { httpStatus, body } = await handleBookingPhoto(
      "REQ123",
      token(),
      JPEG_BYTES,
      freshIp(),
    );

    expect(httpStatus).toBe(200);
    expect(body).toMatchObject({ status: "updated", images_attached: 1 });
    expect(addRequestNoteMock.mock.calls[0][0]).toMatchObject({
      requestId: "REQ123",
      attachmentUrls: [
        "https://integration.example/media/tok1/photo-1-abc123.jpg",
      ],
    });
    const [eventName, update] = eventsEmitMock.mock.calls[0];
    expect(eventName).toBe("slackbot-send-booking-update");
    expect(update.jobberUrl).toBe("https://secure.getjobber.com/requests/1");
    expect(update.text).toBeNull();
    expect(update.images).toHaveLength(1);
    expect(update.fallbackContact.type).toBe("AI Agent Booking Update");
    expect(contactMadeMock).not.toHaveBeenCalled();

    await flush();
    expect(deleteReusableFileMock).toHaveBeenCalledWith("tok1");
  });

  test("the copy is dropped at once if Jobber won't take it", async () => {
    addRequestNoteMock.mockResolvedValue({ attached: false });
    const { body } = await handleBookingPhoto(
      "REQ123",
      token(),
      JPEG_BYTES,
      freshIp(),
    );
    expect(body.images_attached).toBe(0);
    expect(deleteReusableFileMock).toHaveBeenCalledWith("tok1");
  });

  test("a wrong token is a 404 and nothing is read from Jobber", async () => {
    const { httpStatus } = await handleBookingPhoto(
      "REQ123",
      "nope",
      JPEG_BYTES,
      freshIp(),
    );
    expect(httpStatus).toBe(404);
    expect(getRequestForUpdateMock).not.toHaveBeenCalled();
  });

  test.each([
    ["an empty body", Buffer.alloc(0), 422],
    ["something that isn't a photo", Buffer.from("<html>hi</html>"), 422],
    ["a photo over the limit", Buffer.alloc(8 * 1024 * 1024 + 1, 0xff), 413],
  ])("%s is refused with %i", async (_label, bytes, status) => {
    const { httpStatus } = await handleBookingPhoto(
      "REQ123",
      token(),
      bytes,
      freshIp(),
    );
    expect(httpStatus).toBe(status);
    expect(addRequestNoteMock).not.toHaveBeenCalled();
    expect(hostPhotoMock).not.toHaveBeenCalled();
  });

  test("a request staff already started on is no longer editable", async () => {
    getRequestForUpdateMock.mockResolvedValue({
      title: "AI agent request (Claude): plumbing",
      status: "ASSESSMENT_SCHEDULED",
    });
    const { httpStatus } = await handleBookingPhoto(
      "REQ123",
      token(),
      JPEG_BYTES,
      freshIp(),
    );
    expect(httpStatus).toBe(409);
    expect(hostPhotoMock).not.toHaveBeenCalled();
  });

  test("a sixth photo in a day is rate limited", async () => {
    for (let i = 0; i < 5; i++) {
      const { httpStatus } = await handleBookingPhoto(
        "REQ123",
        token(),
        JPEG_BYTES,
        freshIp(),
      );
      expect(httpStatus).toBe(200);
    }
    const { httpStatus } = await handleBookingPhoto(
      "REQ123",
      token(),
      JPEG_BYTES,
      freshIp(),
    );
    expect(httpStatus).toBe(429);
  });
});
