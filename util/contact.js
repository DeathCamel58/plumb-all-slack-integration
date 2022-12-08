/**
 * A contact from a client
 */
class Contact {
    constructor(type, name, phone, alternatePhone, email, address, message) {
        /**
         * The type of contact
         */
        this.contactType = type;
        /**
         * The name of the contact
         */
        this.contactName = name;
        /**
         * The phone of the contact
         */
        this.contactPhone = phone;
        /**
         * The alternate phone of the contact
         * NOTE: This is usually the phone number they called from, rather than the phone number they left.
         */
        this.contactAlternatePhone = alternatePhone;
        /**
         * The email of the contact
         */
        this.contactEmail = email;
        /**
         * The address of the contact
         */
        this.contactAddress = address;
        /**
         * The message from the contact
         */
        this.contactMessage = message;
    }

    get type() {
        return this.contactType;
    }

    set type(type) {
        this.contactType = type;
    }

    get name() {
        return this.contactName;
    }

    set name(name) {
        this.contactName = name;
    }

    get phone() {
        return this.contactPhone;
    }

    set phone(phone) {
        this.contactPhone = phone;
    }

    get alternatePhone() {
        return this.contactAlternatePhone;
    }

    set alternatePhone(alternatePhone) {
        this.contactAlternatePhone = alternatePhone;
    }

    get email() {
        return this.contactEmail;
    }

    set email(email) {
        this.contactEmail = email;
    }

    get address() {
        return this.contactAddress;
    }

    set address(address) {
        this.contactAddress = address;
    }

    get message() {
        return this.contactMessage;
    }

    set message(message) {
        this.contactMessage = message;
    }

    /**
     * Generates the message to send in Slack
     */
    messageToSend() {
        let fullAddressForLink = this.contactAddress.replace(/\s/g, '+');
        let contactInfoParts = [];
        let message = `=== New ${this.contactType} ===\n`;

        // If there is an alternate phone number, use it.
        if (this.contactAlternatePhone !== undefined) {
            contactInfoParts.push(`( Left ${this.contactPhone} but called from: ${this.contactAlternatePhone} )`);
        } else {
            if (this.contactPhone !== undefined) {
                contactInfoParts.push(`( ${this.contactPhone} )`);
            }
        }

        // If there is an email, use it.
        if (this.contactEmail !== undefined) {
            contactInfoParts.push(`( ${this.contactEmail} )`);
        }

        let parenthesisContactInfo = "";
        for (let i = 0; i < contactInfoParts.length; i++) {
            if (i !== 0) {
                parenthesisContactInfo += " ";
            }
            parenthesisContactInfo += contactInfoParts[i];
        }

        message += `Caller: ${this.contactName} ${parenthesisContactInfo}\n`;

        // If there's an address, use it.
        if (this.contactAddress !== "-, - -, -" && this.contactAddress !== "NA, NA NA, NA") {
            message += `Address: <https://www.google.com/maps?hl=en&q=${fullAddressForLink}|${this.contactAddress}>\n`;
        } else {
            message += `Address: Didn't leave one`;
        }

        // If this is a Jobber request, put in the link
        // if (this.contactType === "jobber") {
        //
        // }

        message += `Message: ${this.contactMessage}`;

        return message
    }
}

module.exports = Contact;