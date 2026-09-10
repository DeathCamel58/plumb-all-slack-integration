import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const eventsEmitMock = jest.fn();
const eventsOnMock = jest.fn();

jest.unstable_mockModule("../../util/events.js", () => ({
  default: {
    emit: eventsEmitMock,
    on: eventsOnMock,
  },
}));

await import("../../util/apis/86Repairs.js");

// Capture the workOrderHandle registered by 86Repairs.js
const callHandler = eventsOnMock.mock.calls.find(
  ([name]) => name === "86repairs-call",
)[1];

/**
 * The service request template, as Outlook forwards it to us. The bullets are
 * `・` (U+30FB) and the detail lines are separated by `<br>` rather than
 * newlines, which is why the source line breaks here are meaningless.
 */
function newServiceHtml() {
  return `<html>
<head><style type="text/css">body { font-size:14px }</style></head>
<body>
<font face="Tahoma" size="2"><b>From:</b> service@86repairs.com &lt;service@86repairs.com&gt;<br>
<b>Subject:</b> EMERGENCY DISPATCH REQUEST: Example Diner - Springfield - 101<br>
</font><br>
<div>Email not displaying correctly? <u>View in Browser</u></div>
<div>Hello, <br>
<br>
Service is needed at: Example Diner - Springfield - 101 <br>
・ Address: 100 Example Street, Springfield, Georgia 30000 <br>
・ Location Contact: Alex Example (Area Director) <br>
・ Customer Name: Example Holdings, LLC <br>
<br>
Reported Issue: <br>
・ Alex Example reported an issue with the Plumbing Infrastructure.
Additional details: Pipes are leaking from the mop sink area.
<br>
<br>
Priority: <br>
<b>・ EMERGENCY</b> <br>
<br>
Warranty Check Info: <br>
Asset (Plumbing Infrastructure) is not warranty eligible due to its asset type
(Plumbing Infrastructure)
<br>
<br>
If you have any questions, you can always access details on the <a href="https://example.com">
86 Repairs Portal</a> or call/text (555) 555-0123. <br>
</div>
</body>
</html>`;
}

/**
 * The one time login code email. It has no service request in it at all, so it
 * would otherwise fall through to the "New Service" branch.
 */
function loginCodeHtml() {
  return `<html>
<head><style type="text/css">.login-code { font-size:28pt }</style></head>
<body>
<font face="Tahoma" size="2"><b>From:</b> 86 Repairs &lt;service@86repairs.com&gt;<br>
<b>Subject:</b> 86 Repairs - Login Code<br>
</font><br>
<div>Email not displaying correctly? <u>View in Browser</u></div>
<div>
<div class="login-text">Please enter the code below to log in to the 86 Repairs portal:</div>
<br>
<div class="login-code">123456</div>
</div>
</body>
</html>`;
}

function makeData(bodyHtml) {
  return { payload: { "body-html": bodyHtml, "body-plain": "ignored" } };
}

/**
 * @returns The Contact passed to the most recent `slackbot-send-contact` emit
 */
function sentContact() {
  const call = eventsEmitMock.mock.calls.find(
    ([event]) => event === "slackbot-send-contact",
  );

  return call ? call[1] : undefined;
}

beforeEach(() => {
  eventsEmitMock.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

describe("86Repairs", () => {
  test("A new service request is turned into a Contact", async () => {
    await callHandler(makeData(newServiceHtml()));

    const contact = sentContact();
    expect(contact).toBeDefined();
    expect(contact.contactName).toBe("Example Diner - Springfield - 101");
    expect(contact.contactAddress).toBe(
      "100 Example Street, Springfield, Georgia 30000",
    );
    expect(contact.contactSource).toBe("86Repairs");
  });

  test("The reported issue is kept whole across wrapped lines", async () => {
    await callHandler(makeData(newServiceHtml()));

    expect(sentContact().contactMessage).toContain(
      "Alex Example reported an issue with the Plumbing Infrastructure. " +
        "Additional details: Pipes are leaking from the mop sink area.",
    );
  });

  test("Priority is read from under its heading, through the bold tag", async () => {
    await callHandler(makeData(newServiceHtml()));

    expect(sentContact().contactMessage).toContain("- Priority: EMERGENCY");
  });

  test("Warranty check info is joined back across wrapped lines", async () => {
    await callHandler(makeData(newServiceHtml()));

    expect(sentContact().contactMessage).toContain(
      "- Warranty Check Info: Asset (Plumbing Infrastructure) is not warranty " +
        "eligible due to its asset type (Plumbing Infrastructure)",
    );
  });

  test("A missing field is left out rather than reported as undefined", async () => {
    const html = newServiceHtml().replace(
      "・ Customer Name: Example Holdings, LLC <br>",
      "",
    );

    await callHandler(makeData(html));

    const message = sentContact().contactMessage;
    expect(message).not.toContain("undefined");
    expect(message).not.toContain("Customer Name");
    expect(message).toContain("- Location Contact:");
  });

  test("Service schedule confirmations are ignored", async () => {
    const html = newServiceHtml().replace(
      "Reported Issue:",
      "The service visit is scheduled for: Monday<br>Reported Issue:",
    );

    await callHandler(makeData(html));

    expect(sentContact()).toBeUndefined();
  });

  test("Portal login code emails are ignored", async () => {
    await callHandler(makeData(loginCodeHtml()));

    expect(sentContact()).toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  test("An unparseable email is logged instead of throwing", async () => {
    await expect(
      callHandler(makeData("<html><body>Nothing useful here</body></html>")),
    ).resolves.toBeUndefined();

    expect(sentContact()).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "86 Repairs: Error processing email:",
      expect.objectContaining({
        message: expect.stringContaining("Service is needed at:"),
      }),
    );
  });

  test("A missing body-html is logged instead of throwing", async () => {
    await expect(callHandler({ payload: {} })).resolves.toBeUndefined();

    expect(sentContact()).toBeUndefined();
  });
});
