const assert = require('assert');
const {expect, test} = require('@jest/globals');
const Trello = require('../../util/apis/Trello.js');
const APICoordinator = require("../../util/APICoordinator");
require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });

// TEST
const path = require('path');
const fs = require('fs');
const fullPath = path.join(__dirname, '../../')
fs.readdir(fullPath, function (err, files) {
    files.forEach(function (file) {
        console.log(`File found: ${file}`);
    });
});

console.log(`ENV_LOCATION: ${process.env.ENV_LOCATION}`);
let TRELLO_TOKEN_type = typeof process.env.TRELLO_TOKEN;
if (TRELLO_TOKEN_type === 'string') {
    console.log(`TRELLO_TOKEN length: ${process.env.TRELLO_TOKEN.length}`);
} else {
    console.log(`TRELLO_TOKEN type: ${TRELLO_TOKEN_type}`);
}
let TRELLO_API_KEY_type = typeof process.env.TRELLO_TOKEN;
if (TRELLO_API_KEY_type === 'string') {
    console.log(`TRELLO_API_KEY length: ${process.env.TRELLO_API_KEY.length}`);
} else {
    console.log(`TRELLO_API_KEY type: ${TRELLO_API_KEY_type}`);
}
// /TEST

// We can group similar tests inside a `describe` block
describe("Trello", () => {
    // Test Low Level API
    // Although this function shouldn't be used directly, it is good to test it
    describe("Low Level API", () => {
        test("List Boards (good request)", async () => {
            let url = `1/members/me/boards?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`;
            let response = await Trello.useAPI(url, 'get', null);
            response = JSON.parse(response);
            expect(response.length).toBeGreaterThan(0);
        });

        test("No such endpoint (bad request)", async () => {
            // We expect a `console.error()`, so implement it to hide it.
            jest.spyOn(console, 'error').mockImplementation(() => {});

            let url = `1/bad/endpoint?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`;
            let response = await Trello.useAPI(url, 'get', null);
            expect(response).toBeUndefined();

            // Reset the `console.error()` implementation
            console.error.mockRestore();
        });
    });

    // Test Function Calls
    describe("Functions", () => {
        test("Get Board (Good Name)", async () => {
            let boards = await Trello.getBoard('Calls');
            expect(boards).toBe('63adde25c5407a01b701b210');
        });

        test("Get Board (Bad Name)", async () => {
            let boards = await Trello.getBoard('NoSuchBoard');
            expect(boards).toBeNull();
        });

        test("Get List (Good Name)", async () => {
            let boards = await Trello.getList('63adde25c5407a01b701b210', 'To Do');
            expect(boards).toBe('63adde25c5407a01b701b217');
        });

        test("Get List (Bad List Name)", async () => {
            let boards = await Trello.getList('63adde25c5407a01b701b210', 'NoSuchList');
            expect(boards).toBeNull();
        });

        test("Get List (Bad Board Id)", async () => {
            // We expect a `console.error()`, so implement it to hide it.
            jest.spyOn(console, 'error').mockImplementation(() => {});

            let boards = await Trello.getList('1234567890', 'NoSuchList');
            expect(boards).toBeNull();

            // Reset the `console.error()` implementation
            console.error.mockRestore();
        });

        // TODO: Test Trello runSearch(), addCard(), moveCard(), addContact(), and moveContactCard()
        // This isn't done now, as cards will move and be archived in the environment
    });
});
