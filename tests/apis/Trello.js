const assert = require("assert");
const { expect, test, describe } = require("@jest/globals");
const Trello = require("../../util/apis/Trello.js");
const APICoordinator = require("../../util/APICoordinator.js");
require("dotenv").config({
  path: process.env.ENV_LOCATION || "/root/plumb-all-slack-integration/.env",
});

// We can group similar tests inside a `describe` block
describe("Trello", () => {
  // Test Low Level API
  // Although this function shouldn't be used directly, it is good to test it
  describe("Low Level API", () => {
    test("List Boards (good request)", async () => {
      let url = `1/members/me/boards?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`;
      let response = await Trello.useAPI(url, "get", null);
      response = JSON.parse(response);
      expect(response.length).toBeGreaterThan(0);
    });

    test("No such endpoint (bad request)", async () => {
      // We expect a `console.error()`, so implement it to hide it.
      jest.spyOn(console, "error").mockImplementation(() => {});

      let url = `1/bad/endpoint?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`;
      let response = await Trello.useAPI(url, "get", null);
      expect(response).toBeUndefined();

      // Reset the `console.error()` implementation
      console.error.mockRestore();
    });
  });

  // Test Function Calls
  describe("Functions", () => {
    test("Get Board (Good Name)", async () => {
      let boards = await Trello.getBoard("Calls");
      expect(boards).toBe("63adde25c5407a01b701b210");
    });

    test("Get Board (Bad Name)", async () => {
      let boards = await Trello.getBoard("NoSuchBoard");
      expect(boards).toBeNull();
    });

    test("Get List (Good Name)", async () => {
      let boards = await Trello.getList("63adde25c5407a01b701b210", "To Do");
      expect(boards).toBe("63adde25c5407a01b701b217");
    });

    test("Get List (Bad List Name)", async () => {
      let boards = await Trello.getList(
        "63adde25c5407a01b701b210",
        "NoSuchList",
      );
      expect(boards).toBeNull();
    });

    test("Get List (Bad Board Id)", async () => {
      // We expect a `console.error()`, so implement it to hide it.
      jest.spyOn(console, "error").mockImplementation(() => {});

      let boards = await Trello.getList("1234567890", "NoSuchList");
      expect(boards).toBeNull();

      // Reset the `console.error()` implementation
      console.error.mockRestore();
    });

    // TODO: Test Trello runSearch(), addCard(), moveCard(), addContact(), and moveContactCard()
    // This isn't done now, as cards will move and be archived in the environment
  });
});
