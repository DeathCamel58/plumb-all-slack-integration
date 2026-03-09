import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const fetchMock = jest.fn();

jest.unstable_mockModule("node-fetch", () => ({
  default: fetchMock,
}));

const Trello = await import("../../util/apis/Trello.js");

function buildResponse(status, body) {
  return {
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

beforeEach(() => {
  process.env.TRELLO_API_KEY = "test-key";
  process.env.TRELLO_TOKEN = "test-token";

  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url) => {
    const requestUrl = String(url);

    if (requestUrl.includes("/1/members/me/boards")) {
      return buildResponse(200, [
        { id: "63adde25c5407a01b701b210", name: "Calls" },
        { id: "another-board", name: "Other" },
      ]);
    }

    if (requestUrl.includes("/1/boards/63adde25c5407a01b701b210/lists")) {
      return buildResponse(200, [
        { id: "63adde25c5407a01b701b217", name: "To Do" },
        { id: "63adde25c5407a01b701b218", name: "WIP" },
      ]);
    }

    if (requestUrl.includes("/1/boards/1234567890/lists")) {
      return buildResponse(400, { error: "invalid board id" });
    }

    if (requestUrl.includes("/1/bad/endpoint")) {
      return buildResponse(400, { error: "no such endpoint" });
    }

    return buildResponse(400, { error: "unhandled route" });
  });
});

describe("Trello", () => {
  describe("Low Level API", () => {
    test("List Boards (good request)", async () => {
      const url = `1/members/me/boards?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`;
      let response = await Trello.useAPI(url, "get", null);
      response = JSON.parse(response);
      expect(response.length).toBeGreaterThan(0);
    });

    test("No such endpoint (bad request)", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});

      const url = `1/bad/endpoint?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`;
      const response = await Trello.useAPI(url, "get", null);
      expect(response).toBeUndefined();

      console.error.mockRestore();
    });
  });

  describe("Functions", () => {
    test("Get Board (Good Name)", async () => {
      const boards = await Trello.getBoard("Calls");
      expect(boards).toBe("63adde25c5407a01b701b210");
    });

    test("Get Board (Bad Name)", async () => {
      const boards = await Trello.getBoard("NoSuchBoard");
      expect(boards).toBeNull();
    });

    test("Get List (Good Name)", async () => {
      const boards = await Trello.getList("63adde25c5407a01b701b210", "To Do");
      expect(boards).toBe("63adde25c5407a01b701b217");
    });

    test("Get List (Bad List Name)", async () => {
      const boards = await Trello.getList(
        "63adde25c5407a01b701b210",
        "NoSuchList",
      );
      expect(boards).toBeNull();
    });

    test("Get List (Bad Board Id)", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});

      const boards = await Trello.getList("1234567890", "NoSuchList");
      expect(boards).toBeNull();

      console.error.mockRestore();
    });
  });
});
