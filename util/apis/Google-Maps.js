require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
const { Client } = require("@googlemaps/google-maps-services-js");

const client = new Client();

async function searchPlace(address) {
    let place = client.geocode({
        params: {
            address: address,
            key: process.env.GOOGLE_API_KEY || "GOOGLE_API_KEY"
        }
    });

    return place;
}

module.exports = {
    searchPlace
};
