/**
 * Takes in a phone number, and returns the number in the standard format: `(xxx) xxx-xxxx`
 * @param phone Unparsed phone number
 * @returns {null|*} Parsed Phone Number
 */
function normalizePhoneNumber(phone) {
    //normalize string and remove all unnecessary characters
    phone = phone.replace(/\D/g, "");

    //check if number length equals to 10
    if (phone.length === 11) {
        phone = phone.slice(1);
    }
    if (phone.length === 10) {
        //reformat and return phone number
        return phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3");
    }

    return null;
}

/**
 * Takes in an array, and adds an element in between each item
 * @param arr The array to add elements to
 * @param value The item to add in between elements
 * @returns {*} The array with the additional elements
 */
const interleave = (arr, value) => {
    return arr.reduce((result, element, index, array) => {
        // Push the current element from the original array into the new one
        result.push(element);

        // Only push the additional element if we're not at the end of the original array
        if (index < array.length - 1) {
            result.push(value);
        }

        return result;
    }, []);
}

module.exports = {
    normalizePhoneNumber,
    interleave
};
