import * as DataUtilities from "./DataUtilities.js";
import queryString from "querystring";

/**
 * A contact from a client
 */
export default class Contact {
  constructor(
    type,
    name,
    phone,
    alternatePhone,
    email,
    address,
    message,
    source = null,
  ) {
    /**
     * The type of contact
     */
    this.contactType = type ? type.replace(/^\s+|\s+$/g, "") : type;
    /**
     * The name of the contact
     */
    this.contactName = name ? name.replace(/^\s+|\s+$/g, "") : name;
    /**
     * The phone of the contact
     */
    this.contactPhone = phone
      ? DataUtilities.normalizePhoneNumber(phone)
      : phone;
    /**
     * The digits of the phone number (not standardized)
     */
    this.contactPhoneRaw = this.contactPhone
      ? this.contactPhone.replace(/\D/g, "")
      : this.contactPhone;
    /**
     * The alternate phone of the contact
     * NOTE: This is usually the phone number they called from, rather than the phone number they left.
     */
    this.contactAlternatePhone = alternatePhone
      ? DataUtilities.normalizePhoneNumber(alternatePhone)
      : alternatePhone;
    /**
     * The digits of the alternate phone number (not standardized)
     */
    this.contactAlternatePhoneRaw = this.contactAlternatePhone
      ? this.contactAlternatePhone.replace(/\D/g, "")
      : this.contactAlternatePhone;
    /**
     * The email of the contact
     */
    this.contactEmail = email ? email.replace(/^\s+|\s+$/g, "") : email;
    /**
     * The address of the contact
     */
    this.contactAddress = address ? address.replace(/^\s+|\s+$/g, "") : address;
    /**
     * The message from the contact
     */
    this.contactMessage = message ? message.replace(/^\s+|\s+$/g, "") : message;

    this.contactSource = source ? source : source;
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

  get source() {
    return this.contactSource;
  }

  set source(source) {
    this.contactSource = source;
  }

  /**
   * Generates the message to send
   * @param markdown Whether to return markdown. Defaults to false
   * @return {string} The message to send
   */
  messageToSend(markdown = false) {
    let contactInfoParts = [];
    let message = `=== New ${this.contactType} ===\n`;

    // If there is an alternate phone number, use it.
    if (
      this.contactAlternatePhone !== undefined &&
      this.contactAlternatePhone !== null &&
      this.contactAlternatePhone !== "" &&
      this.contactAlternatePhone !== this.contactPhone
    ) {
      if (!markdown) {
        contactInfoParts.push(
          `( Left ${this.contactPhone} but called from: ${this.contactAlternatePhone} )`,
        );
      } else {
        contactInfoParts.push(
          `( Left [${this.contactPhone}](tel:${this.contactPhoneRaw}) but called from: [${this.contactAlternatePhone}](tel:${this.contactAlternatePhoneRaw}) )`,
        );
      }
    } else {
      if (this.contactPhone !== undefined && this.contactPhone !== "") {
        if (!markdown) {
          contactInfoParts.push(`( ${this.contactPhone} )`);
        } else {
          contactInfoParts.push(
            `( [${this.contactPhone}](tel:${this.contactPhoneRaw}) )`,
          );
        }
      }
    }

    // If there is an email, use it.
    if (this.contactEmail !== undefined && this.contactEmail !== "") {
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
    let tmp = this.contactAddress;
    let isAddress = false;
    if (tmp) {
      tmp = tmp.replace(/ /g, "");
      tmp = tmp.replace(/,/g, "");
      tmp = tmp.replace(/-/g, "");
      tmp = tmp.replace(/\//g, "");
      tmp = tmp.replace(/NA/g, "");
      tmp = tmp.replace(/na/g, "");
      tmp = tmp.replace(/Na/g, "");
      tmp = tmp.replace(/nA/g, "");
    }
    if (typeof tmp !== "undefined" && tmp !== "" && tmp !== "Ga") {
      isAddress = true;
    }

    if (isAddress) {
      let fullAddressForLink = queryString.escape(this.contactAddress);
      if (!markdown) {
        message += `Address: <https://www.google.com/maps/search/?api=1&query=${fullAddressForLink}|${this.contactAddress}>\n`;
      } else {
        message += `Address: [${this.contactAddress}](https://www.google.com/maps/search/?api=1&query=${fullAddressForLink})\n`;
      }
    } else {
      message += `Address: Didn't leave one\n`;
    }

    // If this is a Jobber request, put in the link
    // if (this.contactType === "jobber") {
    //
    // }

    message += `Message: ${this.contactMessage}`;

    return message;
  }
}
