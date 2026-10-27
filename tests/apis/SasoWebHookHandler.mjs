import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsOnMock = jest.fn();
const contactMadeMock = jest.fn();

jest.unstable_mockModule("../../util/events.js", () => ({
  default: { emit: jest.fn(), on: eventsOnMock },
}));
jest.unstable_mockModule("../../util/APICoordinator.js", () => ({
  contactMade: contactMadeMock,
}));

await import("../../util/apis/SasoWebHookHandler.js");

const leadHandle = eventsOnMock.mock.calls.find(
  ([name]) => name === "saso-lead",
)[1];

const lead = (overrides = {}) => ({
  body: JSON.stringify({
    first_name: "Jazmin",
    last_name: "Seeger",
    main_phone_number: "(616) 226-9699",
    caller_id: "+16162269699",
    address: "1390 Jonesboro Road, McDonough, GA 30253",
    ticket_message: "Low water pressure",
    callsource: "sas-phone-call",
    agent_notes: "",
    ...overrides,
  }),
});

beforeEach(() => {
  contactMadeMock.mockReset();
});

describe("SASO lead", () => {
  test("keeps the call source SASO sends", async () => {
    await leadHandle(lead());

    const [contact] = contactMadeMock.mock.calls[0];
    expect(contact.source).toBe("sas-phone-call");
    expect(contact.name).toBe("Jazmin Seeger");
    expect(contact.address).toBe("1390 Jonesboro Road, McDonough, GA 30253");
  });

  test("adds the agent's notes to the message", async () => {
    await leadHandle(lead({ agent_notes: "Prefers mornings" }));

    const [contact] = contactMadeMock.mock.calls[0];
    expect(contact.message).toBe("Low water pressure - Prefers mornings");
  });

  test("ignores a body that isn't JSON", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});

    await leadHandle({ body: "not json" });

    expect(contactMadeMock).not.toHaveBeenCalled();
  });
});
