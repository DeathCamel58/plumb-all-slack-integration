const assert = require('assert');
const {expect, test} = require('@jest/globals');
const GoogleMaps = require('../../util/apis/GoogleMaps');
require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });

// We can group similar tests inside a `describe` block
describe("Google Maps", () => {
    describe("Search for Location", () => {
        test("Valid Location (good request)", async () => {
            let response = await GoogleMaps.searchPlace('206 Washington St SW, Atlanta GA, 30334');
            expect(response.length).toBeGreaterThan(0);
        });

        test("Valid Location (bad request)", async () => {
            let response = await GoogleMaps.searchPlace('-, - -, -');
            expect(response).toBeNull();
        });
    });
});
