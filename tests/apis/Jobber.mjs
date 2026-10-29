import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const fetchMock = jest.fn();
const fsMock = {
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  statSync: jest.fn(() => ({ size: 1 })),
  unlinkSync: jest.fn(),
  renameSync: jest.fn(),
};

jest.unstable_mockModule("node-fetch", () => ({ default: fetchMock }));
jest.unstable_mockModule("fs", () => ({ default: fsMock }));
jest.unstable_mockModule("@sentry/node", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
jest.unstable_mockModule("../../util/events.js", () => ({
  default: { emit: jest.fn(), on: jest.fn() },
}));

const { makeRequest, saveNewToken } = await import("../../util/apis/Jobber.js");

const TOKEN_URL = "https://api.getjobber.com/api/oauth/token";

const response = (status, body = {}) => ({
  status,
  text: async () => JSON.stringify(body),
});

let validToken;
let refreshes;
// Not reset between tests, since the module keeps the last access token
let tokensIssued = 0;

/** Answers token refreshes with a new access token each time */
function refreshResponse() {
  refreshes++;
  tokensIssued++;
  validToken = `access-${tokensIssued}`;
  return response(200, {
    access_token: validToken,
    refresh_token: `refresh-${tokensIssued}`,
  });
}

const tokenOf = (options) => options.headers.Authorization.slice(7);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env.ENV_LOCATION = "test.env";
  process.env.JOBBER_REFRESH_TOKEN = "refresh-0";
  fsMock.readFileSync.mockReturnValue("JOBBER_REFRESH_TOKEN=refresh-0\n");
  // Every test starts with the access token the module holds expired
  validToken = "none";
  refreshes = 0;
});

describe("Jobber token refresh", () => {
  test("requests that fail together share one refresh", async () => {
    fetchMock.mockImplementation(async (url, options) => {
      if (url === TOKEN_URL) {
        // Let both requests see their 401 before the refresh finishes
        await new Promise((resolve) => setTimeout(resolve, 10));
        return refreshResponse();
      }
      return tokenOf(options) === validToken
        ? response(200, { data: { ok: true } })
        : response(401);
    });

    const results = await Promise.all([
      makeRequest("query { a }"),
      makeRequest("query { b }"),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
  });

  test("a 401 for a token another request already replaced doesn't refresh again", async () => {
    let releaseSlowRequest;
    let staleCalls = 0;
    fetchMock.mockImplementation(async (url, options) => {
      if (url === TOKEN_URL) {
        return refreshResponse();
      }
      if (tokenOf(options) === validToken) {
        return response(200, { data: { ok: true } });
      }
      // The first request's 401 only arrives after the second has refreshed
      if (++staleCalls === 1) {
        await new Promise((resolve) => (releaseSlowRequest = resolve));
      }
      return response(401);
    });

    const slow = makeRequest("query { a }");
    await makeRequest("query { b }");
    releaseSlowRequest();

    await expect(slow).resolves.toEqual({ ok: true });
    expect(refreshes).toBe(1);
  });

  test("switches to the new refresh token before saving it to the file", () => {
    saveNewToken("refresh-new");

    expect(process.env.JOBBER_REFRESH_TOKEN).toBe("refresh-new");
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      "test.env2",
      "JOBBER_REFRESH_TOKEN=refresh-new\n",
      "utf8",
    );
    expect(fsMock.renameSync).toHaveBeenCalledWith("test.env2", "test.env");
  });
});
