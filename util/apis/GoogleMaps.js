require("dotenv").config({
  path: process.env.ENV_LOCATION || "/root/plumb-all-slack-integration/.env",
});
const { Client } = require("@googlemaps/google-maps-services-js");
const Sentry = require("@sentry/node");

const client = new Client();

/**
 * Searches Google Maps for a location, and returns the location object
 * @param address
 * @returns {Promise<GeocodeResult[]>}
 */
async function searchPlace(address) {
  try {
    let place = await client.geocode({
      params: {
        address: address,
        key: process.env.GOOGLE_API_KEY || "GOOGLE_API_KEY",
      },
    });

    if (place.data.results.length === 0) {
      return null;
    }

    return place.data.results;
  } catch (e) {
    console.error(`GoogleMaps: Failure in searchPlace`);
    Sentry.captureException(e);
    console.error(e);
  }

  return null;
}

module.exports = {
  searchPlace,
};
