const assert = require("assert");
const { expect, test, describe } = require("@jest/globals");
const PostHog = require("../../util/apis/PostHog");
const Contact = require("../../util/contact");
require("dotenv").config({
  path: process.env.ENV_LOCATION || "/root/plumb-all-slack-integration/.env",
});

// We can group similar tests inside a `describe` block
describe("PostHog", () => {
  describe("Individual Search", () => {
    test("Search for user (single result)", async () => {
      let query = [
        {
          key: "name",
          value: "Dylan Corrales",
          operator: "exact",
          type: "person",
        },
      ];

      let results = await PostHog.individualSearch(query, null);
      expect(results.results.length).toBeGreaterThan(0);
      expect(results.results[0].properties.name).toBe("Dylan Corrales");
    });

    test("Search for user (no result)", async () => {
      let query = [
        {
          key: "name",
          value: "NOT A NAME",
          operator: "exact",
          type: "person",
        },
      ];

      let results = await PostHog.individualSearch(query, null);
      expect(results.results.length).toBe(0);
    });
  });

  describe("Search for contact", () => {
    test("Search for contact (found by name)", async () => {
      let contact = new Contact(
        null,
        "Dylan Corrales",
        null,
        null,
        null,
        null,
        null,
      );

      let results = await PostHog.searchForUser(contact);
      expect(results).toBeDefined();
    });

    test("Search for contact (found by phone)", async () => {
      let contact = new Contact(
        null,
        null,
        "3395269875",
        null,
        null,
        null,
        null,
      );

      let results = await PostHog.searchForUser(contact);
      expect(results).toBeDefined();
    });

    test("Search for contact (found by email)", async () => {
      let contact = new Contact(
        null,
        null,
        null,
        null,
        "deathcamel57@gmail.com",
        null,
        null,
      );

      let results = await PostHog.searchForUser(contact);
      expect(results).toBeDefined();
    });
  });

  describe("Data Ingestion", () => {
    test("Add contact", async () => {
      let contact = new Contact(
        "CI",
        "CI Test User",
        "234-567-8901",
        "012-345-6789",
        "an@email.address",
        "206 WASHINGTON St SW, ATLANTA GA, 30334",
        null,
      );

      let clientID = await PostHog.sendClientToPostHog(contact);
      expect(clientID.length).toBe(32);
    });

    test("Log Contact", async () => {
      let contact = new Contact(
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
      ).resolves.not.toThrowError();
    });

    test("Log Client", async () => {
      let client = {
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

      await expect(PostHog.logClient(client)).resolves.not.toThrowError();
    });

    test("Log Quote", async () => {
      let quote = {
        client: {
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
          billingAddress: {
            street: "218 N McDonough St",
            city: "Jonesboro",
            province: "Georgia",
            postalCode: "30236",
            country: "United States",
          },
        },
        jobberWebUri: "https://secure.getjobber.com/quotes/21258098",
        quoteNumber: "5177",
        quoteStatus: "draft",
        title: "",
        amounts: {
          depositAmount: 0,
          discountAmount: 0,
          nonTaxAmount: 0,
          outstandingDepositAmount: 0,
          subtotal: 0,
          taxAmount: 0,
          total: 0,
        },
      };
      let clientId = "ac72f523deeaac10c22b817d67016273";

      await expect(
        PostHog.logQuote(quote, clientId),
      ).resolves.not.toThrowError();
    });

    test("Log Quote Update", async () => {
      let quote = {
        client: {
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
          billingAddress: {
            street: "218 N McDonough St",
            city: "Jonesboro",
            province: "Georgia",
            postalCode: "30236",
            country: "United States",
          },
        },
        jobberWebUri: "https://secure.getjobber.com/quotes/21258098",
        quoteNumber: "5177",
        quoteStatus: "approved",
        title: "",
        amounts: {
          depositAmount: 0,
          discountAmount: 0,
          nonTaxAmount: 0,
          outstandingDepositAmount: 0,
          subtotal: 0,
          taxAmount: 0,
          total: 0,
        },
      };
      let clientId = "ac72f523deeaac10c22b817d67016273";

      await expect(
        PostHog.logQuoteUpdate(quote, clientId),
      ).resolves.not.toThrowError();
    });

    test("Log Job", async () => {
      let job = {
        client: {
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
          billingAddress: {
            street: "218 N McDonough St",
            city: "Jonesboro",
            province: "Georgia",
            postalCode: "30236",
            country: "United States",
          },
        },
        jobberWebUri: "https://secure.getjobber.com/work_orders/63815895",
        jobNumber: 5187,
        jobStatus: "today",
        title: null,
        total: 0,
      };
      let clientId = "ac72f523deeaac10c22b817d67016273";

      await expect(PostHog.logJob(job, clientId)).resolves.not.toThrowError();
    });

    test("Log Invoice", async () => {
      let invoice = {
        client: {
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
          billingAddress: {
            street: "218 N McDonough St",
            city: "Jonesboro",
            province: "Georgia",
            postalCode: "30236",
            country: "United States",
          },
        },
        subject: "For Services Rendered",
        invoiceNumber: "35696",
        amounts: {
          depositAmount: 0,
          discountAmount: 0,
          invoiceBalance: 0,
          paymentsTotal: 0,
          subtotal: 0,
          tipsTotal: 0,
          total: 0,
        },
      };
      let clientId = "ac72f523deeaac10c22b817d67016273";

      await expect(
        PostHog.logInvoice(invoice, clientId),
      ).resolves.not.toThrowError();
    });

    test("Log Payment", async () => {
      let payment = {
        client: {
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
          billingAddress: {
            street: "218 N McDonough St",
            city: "Jonesboro",
            province: "Georgia",
            postalCode: "30236",
            country: "United States",
          },
        },
        adjustmentType: "PAYMENT",
        amount: 0,
        details: "Payment applied to Invoice #35696",
        paymentOrigin: "EMPLOYEE_ONLINE_ORIGIN",
        paymentType: "OTHER",
      };
      let clientId = "ac72f523deeaac10c22b817d67016273";

      await expect(
        PostHog.logPayment(payment, clientId),
      ).resolves.not.toThrowError();
    });
  });
});
