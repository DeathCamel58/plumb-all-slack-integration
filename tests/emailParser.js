const assert = require('assert');
const EmailParser = require("../util/emailParser");
const APICoordinator = require("../util/APICoordinator");

// Disable `APICoordinator.contactMade` to keep it from sending data to APIs
APICoordinator.contactMade = jest.fn().mockReturnValue({});

// We can group similar tests inside a `describe` block
describe("Email Parser", () => {
    // We can add nested blocks for different tests
    describe( "Answerphone No Alternate", () => {
        // Create contact for use during testing
        let contact = EmailParser.parseMessageFromAnswerphone(
            "Message for 3646    PLUMB-ALL\n" +
            " \n" +
            "Message For: OFFICE          \n" +
            "    Taken  1-SEP-22 at 10:21AM by NRE\n" +
            "------------------------------------------------------------\n" +
            " PH: <D: 123-456-7890 >                              \n" +
            " CALLER:  JOHN DOE                                   \n" +
            " ADDRESS:  206 Washington St SW                      \n" +
            " CITY:  Atlanta                   ST  GA  ZIP  30334 \n" +
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
            assert.equal(contact.address, "206 Washington St SW, Atlanta GA, 30334");
        });

        it("Get Message", () => {
            assert.equal(contact.message, "THIS IS A TEST MESSAGE TO ENSURE THAT THE UNIT TEST WORKS.");
        });
    });

    describe( "Answerphone With Alternate", () => {
        // Create contact for use during testing
        let contact = EmailParser.parseMessageFromAnswerphone(
            "Message for 3646    PLUMB-ALL\n" +
            " \n" +
            "Message For: OFFICE          \n" +
            "    Taken  1-SEP-22 at 10:21AM by NRE\n" +
            "------------------------------------------------------------\n" +
            " PH: <D: 123-456-7890 >                              \n" +
            " CALLER:  JOHN DOE                                   \n" +
            " ADDRESS:  206 WASHINGTON St SW                      \n" +
            " CITY:  ATLANTA                   ST  GA  ZIP  30334 \n" +
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
            assert.equal(contact.address, "206 WASHINGTON St SW, ATLANTA GA, 30334");
        });

        it("Get Message", () => {
            assert.equal(contact.message, "THIS IS A TEST MESSAGE TO ENSURE THAT THE UNIT TEST WORKS.");
        });
    });

    describe( "Website Contact", () => {
        // Create contact for use during testing
        let contact = EmailParser.parseMessageFromWebsite(
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
            "206 Washington St SW, Atlanta, GA 30334\n" +
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
            assert.equal(contact.address, "206 Washington St SW, Atlanta, GA 30334");
        });

        it("Get Message", () => {
            assert.equal(contact.message, "This is a test message to ensure that the unit test works.");
        });
    });

    describe( "Data Cleaning", () => {
        it("Clean Text (undefined)", () => {
            let normalized = EmailParser.cleanText(undefined);
            assert.equal(normalized, "");
        });
        it("Clean Text (\\n)", () => {
            let normalized = EmailParser.cleanText("This is\nsome test\ntext!");
            assert.equal(normalized, "This is some test text!");
        });
        it("Clean Text (\\r)", () => {
            let normalized = EmailParser.cleanText("This is\nsome test\ntext!");
            assert.equal(normalized, "This is some test text!");
        });
        it("Clean Text (\\n + \\r)", () => {
            let normalized = EmailParser.cleanText("This is\n\r\n\rsome test\n\r\n\rtext!");
            assert.equal(normalized, "This is some test text!");
        });
        it("Clean Text (duplicate spaces)", () => {
            let normalized = EmailParser.cleanText("This         is   some    test       text!");
            assert.equal(normalized, "This is some test text!");
        });
        it("Clean Text (leading and trailing spaces)", () => {
            let normalized = EmailParser.cleanText("  This is some test text!  ");
            assert.equal(normalized, "This is some test text!");
        });
        it("Clean Text (~)", () => {
            let normalized = EmailParser.cleanText("This is~some~test text!");
            assert.equal(normalized, "This is some test text!");
        });
        it("Clean Text (~s)", () => {
            let normalized = EmailParser.cleanText("This is~~some~~~~~~~test text!");
            assert.equal(normalized, "This is some test text!");
        });
        it("Clean Text (-)", () => {
            let normalized = EmailParser.cleanText("This is - some test text!");
            assert.equal(normalized, "This is - some test text!");
        });
        it("Clean Text (-s)", () => {
            let normalized = EmailParser.cleanText("This is ------------ some test text!");
            assert.equal(normalized, "This is some test text!");
        });
    });
});
