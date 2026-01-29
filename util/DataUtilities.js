/**
 * Takes in a phone number, and returns the number in the standard format: `(###) ###-####` or `(###) ###-#### x###`
 * @param phone Unparsed phone number
 * @returns {null|*} Parsed Phone Number
 */
export function normalizePhoneNumber(phone) {
  //normalize string and remove all unnecessary characters
  phone = phone.replace(/\D/g, "");

  //check if number length equals to 10
  if (phone[0] === "1") {
    phone = phone.slice(1);
  }
  if (phone.length === 10) {
    //reformat and return phone number
    return phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3");
  } else if (phone.length > 10) {
    return phone.replace(/(\d{3})(\d{3})(\d{4})(\d+)/, "($1) $2-$3 x$4");
  }

  return null;
}

/**
 * Takes in an array, and adds an element in between each item
 * @param arr The array to add elements to
 * @param value The item to add in between elements
 * @returns {*} The array with the additional elements
 */
export const interleave = (arr, value) => {
  return arr.reduce((result, element, index, array) => {
    // Push the current element from the original array into the new one
    result.push(element);

    // Only push the additional element if we're not at the end of the original array
    if (index < array.length - 1) {
      result.push(value);
    }

    return result;
  }, []);
};

/**
 * Very small helper to coerce common US phone formats into E.164 for Twilio.
 * If you need international support, we can expand this later.
 */
export function toE164(input) {
  if (!input) return null;
  const trimmed = String(input).trim();

  // Already E.164-ish
  if (/^\+\d{10,15}$/.test(trimmed)) return trimmed;

  // Strip to digits and assume US if 10 digits, or 11 starting with 1
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  return null;
}
