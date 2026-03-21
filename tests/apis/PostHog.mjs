import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const fetchMock = jest.fn();
const searchPlaceMock = jest.fn();

jest.unstable_mockModule("node-fetch", () => ({
  default: fetchMock,
}));

jest.unstable_mockModule("../../util/apis/GoogleMaps.js", () => ({
  searchPlace: searchPlaceMock,
}));

const PostHog = await import("../../util/apis/PostHog.js");
const { default: Contact } = await import("../../util/contact.js");

function buildResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function getQuery(url) {
  const parsed = new URL(url);
  const rawProperties = parsed.searchParams.get("properties");
  if (!rawProperties) {
    return null;
  }

  return JSON.parse(decodeURIComponent(rawProperties));
}

function installFetchMock() {
  fetchMock.mockImplementation(async (url, options) => {
    const requestUrl = String(url);

    // Handle HogQL query endpoint (used by searchByPhone)
    if (requestUrl.includes("/query/") && options?.body) {
      const body = JSON.parse(options.body);
      const hogql = body.query?.query || "";

      // Check if the query contains a phone number we know about
      if (hogql.includes("3395269875") || hogql.includes("(339) 526-9875")) {
        return buildResponse({ results: [["phone-id"]] });
      }

      return buildResponse({ results: [] });
    }

    if (requestUrl.includes("/persons/")) {
      const query = getQuery(requestUrl);
      const key = query?.[0]?.key;
      const value = query?.[0]?.value;

      if (key === "name" && value === "Dylan Corrales") {
        return buildResponse({
          results: [
            {
              distinct_ids: ["name-id"],
              properties: { name: "Dylan Corrales" },
            },
          ],
        });
      }

      if (key === "phone" && (value === "3395269875" || value === "(339) 526-9875")) {
        return buildResponse({
          results: [
            {
              distinct_ids: ["phone-id"],
              properties: { phone: "3395269875" },
            },
          ],
        });
      }

      if (key === "email" && value === "deathcamel57@gmail.com") {
        return buildResponse({
          results: [
            {
              distinct_ids: ["email-id"],
              properties: { email: "deathcamel57@gmail.com" },
            },
          ],
        });
      }

      return buildResponse({ results: [] });
    }

    return buildResponse({ ok: true });
  });
}

function getCaptureEvents() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/capture/"))
    .map(([, options]) => JSON.parse(options.body).event)
    .filter(Boolean);
}

beforeEach(() => {
  process.env.POSTHOG_HOST = "https://app.posthog.com";
  process.env.POSTHOG_PROJECT_ID = "project-id";
  process.env.POSTHOG_API_TOKEN = "api-token";
  process.env.POSTHOG_TOKEN = "project-token";

  fetchMock.mockReset();
  searchPlaceMock.mockReset();

  searchPlaceMock.mockResolvedValue([
    {
      address_components: [
        {},
        {},
        { long_name: "Atlanta" },
        { long_name: "Georgia" },
        {},
        { short_name: "US", long_name: "United States" },
        { long_name: "30334" },
      ],
    },
  ]);

  installFetchMock();
});

describe("PostHog", () => {
  describe("Individual Search", () => {
    test("Search for user (single result)", async () => {
      const query = [
        {
          key: "name",
          value: "Dylan Corrales",
          operator: "exact",
          type: "person",
        },
      ];

      const results = await PostHog.individualSearch(query, null);
      expect(results.results.length).toBeGreaterThan(0);
      expect(results.results[0].properties.name).toBe("Dylan Corrales");
      expect(fetchMock).toHaveBeenCalled();
    });

    test("Search for user (no result)", async () => {
      const query = [
        {
          key: "name",
          value: "NOT A NAME",
          operator: "exact",
          type: "person",
        },
      ];

      const results = await PostHog.individualSearch(query, null);
      expect(results.results.length).toBe(0);
    });
  });

  describe("Search for contact", () => {
    test("Search for contact (found by name)", async () => {
      const contact = new Contact(
        null,
        "Dylan Corrales",
        null,
        null,
        null,
        null,
        null,
      );

      const results = await PostHog.searchForUser(contact);
      expect(results).toBe("name-id");
    });

    test("Search for contact (found by phone)", async () => {
      const contact = new Contact(
        null,
        null,
        "3395269875",
        null,
        null,
        null,
        null,
      );

      const results = await PostHog.searchForUser(contact);
      expect(results).toBe("phone-id");
    });

    test("Search for contact (found by email)", async () => {
      const contact = new Contact(
        null,
        null,
        null,
        null,
        "deathcamel57@gmail.com",
        null,
        null,
      );

      const results = await PostHog.searchForUser(contact);
      expect(results).toBe("email-id");
    });
  });

  describe("Data Ingestion", () => {
    test("Add contact", async () => {
      const contact = new Contact(
        "CI",
        "CI Test User",
        "234-567-8901",
        "012-345-6789",
        "an@email.address",
        "206 WASHINGTON St SW, ATLANTA GA, 30334",
        null,
      );

      const clientID = await PostHog.sendClientToPostHog(contact);
      expect(clientID.length).toBe(32);
      expect(searchPlaceMock).toHaveBeenCalled();
      expect(getCaptureEvents()).toContain("$identify");
    });

    test("Log Contact", async () => {
      const contact = new Contact(
        "CI",
        "CI Test User",
        "234-567-8901",
        "012-345-6789",
        "an@email.address",
        "206 WASHINGTON St SW, ATLANTA GA, 30334",
        "TEST MESSAGE FROM CI",
      );

      await expect(
        PostHog.logContact(
          contact,
          "MESSAGE WAS FROM CI/CD PIPELINE: TEST MESSAGE FROM CI",
        ),
      ).resolves.not.toThrow();

      const events = getCaptureEvents();
      expect(events).toContain("$identify");
      expect(events).toContain("contact made");
    });

    test("Log Client", async () => {
      const client = {
        id: "Z2lkOi8vSm9iYmVyL0NsaWVudC82MjI3MDc0Mg==",
        name: "TEST TEST",
        companyName: null,
        defaultEmails: [],
        phones: [],
        emails: [],
        firstName: "TEST",
        lastName: "TEST",
        isCompany: false,
        jobberWebUri: "https://secure.getjobber.com/clients/62270742",
        secondaryName: null,
        title: null,
        billingAddress: null,
      };

      const clientID = await PostHog.logClient(client);
      expect(clientID).toBe("Z2lkOi8vSm9iYmVyL0NsaWVudC82MjI3MDc0Mg==");
      expect(getCaptureEvents()).toContain("$identify");

      // Verify the $identify call uses the Jobber client ID as distinct_id
      const identifyCall = fetchMock.mock.calls.find(
        ([url, opts]) =>
          String(url).includes("/capture/") &&
          opts &&
          JSON.parse(opts.body).event === "$identify",
      );
      expect(identifyCall).toBeDefined();
      const identifyBody = JSON.parse(identifyCall[1].body);
      expect(identifyBody.distinct_id).toBe(
        "Z2lkOi8vSm9iYmVyL0NsaWVudC82MjI3MDc0Mg==",
      );
    });

    test("Log Client merges duplicate persons", async () => {
      const client = {
        id: "Z2lkOi8vSm9iYmVyL0NsaWVudC85OTk5",
        name: "Dylan Corrales",
        companyName: null,
        defaultEmails: ["deathcamel57@gmail.com"],
        phones: [{ number: "(339) 526-9875", primary: true }],
        emails: [{ address: "deathcamel57@gmail.com", primary: true }],
        firstName: "Dylan",
        lastName: "Corrales",
        isCompany: false,
        jobberWebUri: "https://secure.getjobber.com/clients/9999",
        secondaryName: null,
        title: null,
        billingAddress: null,
      };

      await PostHog.logClient(client);

      const events = getCaptureEvents();
      expect(events).toContain("$identify");
      expect(events).toContain("$merge_dangerously");

      // Find all merge calls
      const mergeCalls = fetchMock.mock.calls.filter(
        ([url, opts]) =>
          String(url).includes("/capture/") &&
          opts &&
          JSON.parse(opts.body).event === "$merge_dangerously",
      );

      // Should have merged the old duplicate persons found by name/email/phone search
      expect(mergeCalls.length).toBeGreaterThan(0);

      // Each merge should target the Jobber client ID and alias the old ID
      for (const [, opts] of mergeCalls) {
        const body = JSON.parse(opts.body);
        expect(body.distinct_id).toBe("Z2lkOi8vSm9iYmVyL0NsaWVudC85OTk5");
        expect(body.properties.alias).not.toBe(
          "Z2lkOi8vSm9iYmVyL0NsaWVudC85OTk5",
        );
      }
    });

    test("Log Client does not merge when no duplicates found", async () => {
      const client = {
        id: "Z2lkOi8vSm9iYmVyL0NsaWVudC82MjI3MDc0Mg==",
        name: "TEST TEST",
        companyName: null,
        defaultEmails: [],
        phones: [],
        emails: [],
        firstName: "TEST",
        lastName: "TEST",
        isCompany: false,
        jobberWebUri: "https://secure.getjobber.com/clients/62270742",
        secondaryName: null,
        title: null,
        billingAddress: null,
      };

      await PostHog.logClient(client);

      const events = getCaptureEvents();
      expect(events).toContain("$identify");
      expect(events).not.toContain("$merge_dangerously");
    });

    test("Log Quote", async () => {
      const quote = {
        quoteNumber: "5177",
        quoteStatus: "draft",
        amounts: {
          depositAmount: 0,
          discountAmount: 0,
          outstandingDepositAmount: 0,
          subtotal: 0,
          total: 0,
        },
      };
      const clientId = "ac72f523deeaac10c22b817d67016273";

      await expect(PostHog.logQuote(quote, clientId)).resolves.not.toThrow();
      expect(getCaptureEvents()).toContain("quote made");
    });

    test("Log Quote Update", async () => {
      const quote = {
        quoteNumber: "5177",
        quoteStatus: "approved",
        amounts: {
          depositAmount: 0,
          discountAmount: 0,
          outstandingDepositAmount: 0,
          subtotal: 0,
          total: 0,
        },
      };
      const clientId = "ac72f523deeaac10c22b817d67016273";

      await expect(
        PostHog.logQuoteUpdate(quote, clientId),
      ).resolves.not.toThrow();
      expect(getCaptureEvents()).toContain("quote accepted");
    });

    test("Log Job", async () => {
      const job = {
        jobNumber: 5187,
        jobStatus: "today",
        title: null,
        total: 0,
      };
      const clientId = "ac72f523deeaac10c22b817d67016273";

      await expect(PostHog.logJob(job, clientId)).resolves.not.toThrow();
      expect(getCaptureEvents()).toContain("job made");
    });

    test("Log Invoice", async () => {
      const invoice = {
        subject: "For Services Rendered",
        invoiceNumber: "35696",
        amounts: {
          depositAmount: 0,
          discountAmount: 0,
          invoiceBalance: 0,
          paymentsTotal: 0,
          subtotal: 0,
          total: 0,
        },
      };
      const clientId = "ac72f523deeaac10c22b817d67016273";

      await expect(PostHog.logInvoice(invoice, clientId)).resolves.not.toThrow();
      expect(getCaptureEvents()).toContain("invoice made");
    });

    test("Log Payment", async () => {
      const payment = {
        adjustmentType: "PAYMENT",
        amount: 0,
        details: "Payment applied to Invoice #35696",
        paymentOrigin: "EMPLOYEE_ONLINE_ORIGIN",
        paymentType: "OTHER",
      };
      const clientId = "ac72f523deeaac10c22b817d67016273";

      await expect(PostHog.logPayment(payment, clientId)).resolves.not.toThrow();
      expect(getCaptureEvents()).toContain("payment made");
    });
  });
});
