const assert = require("assert");
const Contact = require("../util/contact");
const { describe, it } = require("@jest/globals");

// We can group similar tests inside a `describe` block
describe("Contact Class", () => {
  // We can add nested blocks for different tests
  describe("Getters and Setters", () => {
    // Create contact for use during testing
    let contact = new Contact(
      "Call",
      "Test Name",
      "555-123-4567",
      "555-234-5678",
      "email@address.com",
      "240 Wallaby Way, Sydney Australia",
      "This is a test message.",
      "Google",
    );

    it("Get Type", () => {
      assert.equal(contact.type, "Call");
    });

    it("Get Name", () => {
      assert.equal(contact.name, "Test Name");
    });

    it("Get Phone", () => {
      assert.equal(contact.phone, "(555) 123-4567");
    });

    it("Get Alternate Phone", () => {
      assert.equal(contact.alternatePhone, "(555) 234-5678");
    });

    it("Get Email", () => {
      assert.equal(contact.email, "email@address.com");
    });

    it("Get Address", () => {
      assert.equal(contact.address, "240 Wallaby Way, Sydney Australia");
    });

    it("Get Message", () => {
      assert.equal(contact.message, "This is a test message.");
    });

    it("Get Source", () => {
      assert.equal(contact.source, "Google");
    });

    it("Set Type", () => {
      contact.type = "TEST VALUE1";
      assert.equal(contact.type, "TEST VALUE1");
    });

    it("Set Name", () => {
      contact.name = "TEST VALUE2";
      assert.equal(contact.name, "TEST VALUE2");
    });

    it("Set Phone", () => {
      contact.phone = "012-345-6789";
      assert.equal(contact.phone, "012-345-6789");
    });

    it("Set Alternate Phone", () => {
      contact.alternatePhone = "123-456-7890";
      assert.equal(contact.alternatePhone, "123-456-7890");
    });

    it("Set Email", () => {
      contact.email = "newemail@address.com";
      assert.equal(contact.email, "newemail@address.com");
    });

    it("Set Address", () => {
      contact.address = "123 New Address Ln, Washington DC 12345";
      assert.equal(contact.address, "123 New Address Ln, Washington DC 12345");
    });

    it("Set Message", () => {
      contact.message = "TEST VALUE3";
      assert.equal(contact.message, "TEST VALUE3");
    });

    it("Set Source", () => {
      contact.source = "TEST VALUE4";
      assert.equal(contact.source, "TEST VALUE4");
    });
  });

  describe("Message Generation", () => {
    // Call contacts
    it("Answerphone Message (Phone)", () => {
      let contact = new Contact(
        "Call",
        "Test Name",
        "555-123-4567",
        undefined,
        undefined,
        "240 Wallaby Way, Sydney Australia",
        "This is a test message.",
      );
      assert.equal(
        contact.messageToSend(),
        "=== New Call ===\n" +
          "Caller: Test Name ( (555) 123-4567 )\n" +
          "Address: <https://www.google.com/maps/search/?api=1&query=240%20Wallaby%20Way%2C%20Sydney%20Australia|240 Wallaby Way, Sydney Australia>\n" +
          "Message: This is a test message.",
      );
    });

    it("Answerphone Message (Phone, Bad Address)", () => {
      let contact = new Contact(
        "Call",
        "Test Name",
        "555-123-4567",
        undefined,
        undefined,
        "NA, NA NA, NA",
        "This is a test message.",
      );
      assert.equal(
        contact.messageToSend(),
        "=== New Call ===\n" +
          "Caller: Test Name ( (555) 123-4567 )\n" +
          "Address: Didn't leave one\n" +
          "Message: This is a test message.",
      );
    });

    it("Answerphone Message (Phone and Email)", () => {
      let contact = new Contact(
        "Call",
        "Test Name",
        "555-123-4567",
        undefined,
        "email@address.com",
        "240 Wallaby Way, Sydney Australia",
        "This is a test message.",
      );
      assert.equal(
        contact.messageToSend(),
        "=== New Call ===\n" +
          "Caller: Test Name ( (555) 123-4567 ) ( email@address.com )\n" +
          "Address: <https://www.google.com/maps/search/?api=1&query=240%20Wallaby%20Way%2C%20Sydney%20Australia|240 Wallaby Way, Sydney Australia>\n" +
          "Message: This is a test message.",
      );
    });

    it("Answerphone Message (Phone, Email, Alternate Number)", () => {
      let contact = new Contact(
        "Call",
        "Test Name",
        "555-123-4567",
        "555-234-5678",
        "email@address.com",
        "240 Wallaby Way, Sydney Australia",
        "This is a test message.",
      );
      assert.equal(
        contact.messageToSend(),
        "=== New Call ===\n" +
          "Caller: Test Name ( Left (555) 123-4567 but called from: (555) 234-5678 ) ( email@address.com )\n" +
          "Address: <https://www.google.com/maps/search/?api=1&query=240%20Wallaby%20Way%2C%20Sydney%20Australia|240 Wallaby Way, Sydney Australia>\n" +
          "Message: This is a test message.",
      );
    });

    it("Answerphone Message (Phone and Alternate Number)", () => {
      let contact = new Contact(
        "Call",
        "Test Name",
        "555-123-4567",
        "555-234-5678",
        undefined,
        "240 Wallaby Way, Sydney Australia",
        "This is a test message.",
      );
      assert.equal(
        contact.messageToSend(),
        "=== New Call ===\n" +
          "Caller: Test Name ( Left (555) 123-4567 but called from: (555) 234-5678 )\n" +
          "Address: <https://www.google.com/maps/search/?api=1&query=240%20Wallaby%20Way%2C%20Sydney%20Australia|240 Wallaby Way, Sydney Australia>\n" +
          "Message: This is a test message.",
      );
    });

    // Website contacts
    it("Message from Website (Phone)", () => {
      let contact = new Contact(
        "Message from Website",
        "Test Name",
        "555-123-4567",
        undefined,
        undefined,
        "240 Wallaby Way, Sydney Australia",
        "This is a test message.",
      );
      assert.equal(
        contact.messageToSend(),
        "=== New Message from Website ===\n" +
          "Caller: Test Name ( (555) 123-4567 )\n" +
          "Address: <https://www.google.com/maps/search/?api=1&query=240%20Wallaby%20Way%2C%20Sydney%20Australia|240 Wallaby Way, Sydney Australia>\n" +
          "Message: This is a test message.",
      );
    });

    it("Message from Website (Phone and Email)", () => {
      let contact = new Contact(
        "Message from Website",
        "Test Name",
        "555-123-4567",
        undefined,
        "email@address.com",
        "240 Wallaby Way, Sydney Australia",
        "This is a test message.",
      );
      assert.equal(
        contact.messageToSend(),
        "=== New Message from Website ===\n" +
          "Caller: Test Name ( (555) 123-4567 ) ( email@address.com )\n" +
          "Address: <https://www.google.com/maps/search/?api=1&query=240%20Wallaby%20Way%2C%20Sydney%20Australia|240 Wallaby Way, Sydney Australia>\n" +
          "Message: This is a test message.",
      );
    });

    it("Message from Website (Email)", () => {
      let contact = new Contact(
        "Message from Website",
        "Test Name",
        undefined,
        undefined,
        "email@address.com",
        "240 Wallaby Way, Sydney Australia",
        "This is a test message.",
      );
      assert.equal(
        contact.messageToSend(),
        "=== New Message from Website ===\n" +
          "Caller: Test Name ( email@address.com )\n" +
          "Address: <https://www.google.com/maps/search/?api=1&query=240%20Wallaby%20Way%2C%20Sydney%20Australia|240 Wallaby Way, Sydney Australia>\n" +
          "Message: This is a test message.",
      );
    });
  });
});
