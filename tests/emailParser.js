const assert = require('assert');
const Contact = require('../util/emailParser.js');
const {parseMessageFromAnswerphone, parseMessageFromWebsite, parseMessageFromJobber} = require("../util/emailParser");

// We can group similar tests inside a `describe` block
describe("Email Parser", () => {
    // We can add nested blocks for different tests
    describe( "Answerphone No Alternate", () => {
        // Create contact for use during testing
        let contact = parseMessageFromAnswerphone(
            "Message for 3646    PLUMB-ALL\n" +
            " \n" +
            "Message For: OFFICE          \n" +
            "    Taken  1-SEP-22 at 10:21AM by NRE\n" +
            "------------------------------------------------------------\n" +
            " PH: <D: 123-456-7890 >                              \n" +
            " CALLER:  JOHN DOE                                   \n" +
            " ADDRESS:  123 SOME STREET                           \n" +
            " CITY:  CITY NAME                 ST  GA  ZIP  12345 \n" +
            " RE:  THIS IS A TEST MESSAGE TO ENSURE THAT THE UNIT \n" +
            " TEST WORKS.                                        ~\n" +
            "                                                     \n" +
            "                                                     \n" +
            "                                                     \n" +
            "                                                     \n" +
            "~ CALLERID:  1234567890    MSGID:  2209012476        \n" +
            "                                                     \n" +
            "============================================================\n"
        );

        it("Get Type", () => {
            assert.equal(contact.type, "Call");
        });

        it("Get Name", () => {
            assert.equal(contact.name, "JOHN DOE");
        });

        it("Get Phone", () => {
            assert.equal(contact.phone, "(123) 456-7890");
        });

        it("Get Alternate Phone", () => {
            assert.equal(contact.alternatePhone, "(123) 456-7890");
        });

        it("Get Email", () => {
            assert.equal(contact.email, undefined);
        });

        it("Get Address", () => {
            assert.equal(contact.address, "123 SOME STREET, CITY NAME GA, 12345");
        });

        it("Get Message", () => {
            assert.equal(contact.message, "THIS IS A TEST MESSAGE TO ENSURE THAT THE UNIT TEST WORKS.");
        });
    });

    describe( "Answerphone With Alternate", () => {
        // Create contact for use during testing
        let contact = parseMessageFromAnswerphone(
            "Message for 3646    PLUMB-ALL\n" +
            " \n" +
            "Message For: OFFICE          \n" +
            "    Taken  1-SEP-22 at 10:21AM by NRE\n" +
            "------------------------------------------------------------\n" +
            " PH: <D: 123-456-7890 >                              \n" +
            " CALLER:  JOHN DOE                                   \n" +
            " ADDRESS:  123 SOME STREET                           \n" +
            " CITY:  CITY NAME                 ST  GA  ZIP  12345 \n" +
            " RE:  THIS IS A TEST MESSAGE TO ENSURE THAT THE UNIT \n" +
            " TEST WORKS.                                        ~\n" +
            "                                                     \n" +
            "                                                     \n" +
            "                                                     \n" +
            "                                                     \n" +
            "~ CALLERID:  0123456789    MSGID:  2209012476        \n" +
            "                                                     \n" +
            "============================================================\n"
        );

        it("Get Type", () => {
            assert.equal(contact.type, "Call");
        });

        it("Get Name", () => {
            assert.equal(contact.name, "JOHN DOE");
        });

        it("Get Phone", () => {
            assert.equal(contact.phone, "(123) 456-7890");
        });

        it("Get Alternate Phone", () => {
            assert.equal(contact.alternatePhone, "(012) 345-6789");
        });

        it("Get Email", () => {
            assert.equal(contact.email, undefined);
        });

        it("Get Address", () => {
            assert.equal(contact.address, "123 SOME STREET, CITY NAME GA, 12345");
        });

        it("Get Message", () => {
            assert.equal(contact.message, "THIS IS A TEST MESSAGE TO ENSURE THAT THE UNIT TEST WORKS.");
        });
    });

    describe( "Website Contact", () => {
        // Create contact for use during testing
        let contact = parseMessageFromWebsite(
            "Someone just submitted your form on https://plumb-all.com/.\n" +
            "\n" +
            "Here's what they had to say:\n" +
            "\n" +
            "name:\n" +
            "\n" +
            "John Doe\n" +
            "\n" +
            "________________________________\n" +
            "email:\n" +
            "\n" +
            "emailAddress@domain.com\n" +
            "\n" +
            "________________________________\n" +
            "phone:\n" +
            "\n" +
            "1234567890\n" +
            "\n" +
            "________________________________\n" +
            "address:\n" +
            "\n" +
            "123 Some Street, City Name GA, 12345\n" +
            "\n" +
            "________________________________\n" +
            "website:\n" +
            "\n" +
            "________________________________\n" +
            "message:\n" +
            "\n" +
            "This is a test message to ensure that the unit test works.\n" +
            "\n" +
            "________________________________\n" +
            "\n" +
            "Submitted at Thu, Dec 8, 2022 7:38 AM (UTC)\n" +
            "\n" +
            "\n" +
            "Sponsor<https://formsubmit.co/sponsor>\n" +
            "\n" +
            "[mailtie forwarding] Free Email Forwarding for Your Custom Domain Learn more →<https://mailtie.com/?ref=formsubmit>\n" +
            "\n" +
            "\n" +
            "Your friends from,\n" +
            "\n" +
            "FormSubmit Team<https://formsubmit.co>\n"
        );

        it("Get Type", () => {
            assert.equal(contact.type, "Message From Website");
        });

        it("Get Name", () => {
            assert.equal(contact.name, "John Doe");
        });

        it("Get Phone", () => {
            assert.equal(contact.phone, "(123) 456-7890");
        });

        it("Get Alternate Phone", () => {
            assert.equal(contact.alternatePhone, undefined);
        });

        it("Get Email", () => {
            assert.equal(contact.email, "emailAddress@domain.com");
        });

        it("Get Address", () => {
            assert.equal(contact.address, "123 Some Street, City Name GA, 12345");
        });

        it("Get Message", () => {
            assert.equal(contact.message, "This is a test message to ensure that the unit test works.");
        });
    });

    describe( "Jobber Request", () => {
        // Create contact for use during testing
        let contact = parseMessageFromJobber(
            "\n" +
            "        [Jobber] <https://a.url.com/ls/click?upn=no-doxxing>\n" +
            "\n" +
            "\n" +
            "\n" +
            "New request\n" +
            "Contact name\n" +
            "\n" +
            "John Doe\n" +
            "\n" +
            "Email\n" +
            "\n" +
            "emailAddress@domain.com\n" +
            "\n" +
            "Phone\n" +
            "\n" +
            "1234567890\n" +
            "\n" +
            "Address\n" +
            "\n" +
            "123 Some Street,\n" +
            "City Name GA, 12345\n" +
            "\n" +
            "View Request<https://a.url.com/ls/click?upn=no-doxxing>\n" +
            "\n" +
            "\n" +
            "\n" +
            "\n" +
            "Questions?\n" +
            "\n" +
            "Visit our Help Center<https://a.url.com/ls/click?upn=no-doxxing>\n" +
            "\n" +
            "\n" +
            "\n" +
            "\n" +
            "\n" +
            "\n" +
            "\n" +
            "Delivered by Jobber | 10130 103 Street NW, Edmonton, AB T5J 3N9, Canada\n" +
            "Terms of Service<https://a.url.com/ls/click?upn=no-doxxing>\n" +
            "Copyright © 2022, Octopusapp, Inc.\n" +
            "\n" +
            "\n" +
            "\n" +
            "\n"
        );

        it("Get Type", () => {
            assert.equal(contact.type, "Message From Jobber Request");
        });

        it("Get Name", () => {
            assert.equal(contact.name, "John Doe");
        });

        it("Get Phone", () => {
            assert.equal(contact.phone, "(123) 456-7890");
        });

        it("Get Alternate Phone", () => {
            assert.equal(contact.alternatePhone, undefined);
        });

        it("Get Email", () => {
            assert.equal(contact.email, "emailAddress@domain.com");
        });

        it("Get Address", () => {
            assert.equal(contact.address, "123 Some Street, City Name GA, 12345");
        });

        it("Get Message", () => {
            assert.equal(contact.message, "<https://a.url.com/ls/click?upn=no-doxxin|Details in Jobber> (You may have to hold on that link, copy it, and paste it into your web browser to access it)");
        });
    });
});