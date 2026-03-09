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
    status,
    text: async () => JSON.stringify(body),
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
  fetchMock.mockImplementation(async (url) => {
    const requestUrl = String(url);

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

      await expect(PostHog.logClient(client)).resolves.not.toThrow();
      expect(getCaptureEvents()).toContain("$identify");
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
