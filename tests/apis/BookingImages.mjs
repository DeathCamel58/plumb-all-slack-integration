import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Readable } from "stream";

const fetchMock = jest.fn();
const hostReusableFileMock = jest.fn();

jest.unstable_mockModule("node-fetch", () => ({ default: fetchMock }));
jest.unstable_mockModule("../../util/mediaStore.js", () => ({
  hostReusableFile: hostReusableFileMock,
}));

const { downloadImage, hostBookingImages, isPrivateAddress, sniffImageType } =
  await import("../../util/apis/BookingImages.js");

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64),
]);
const PNG = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  Buffer.alloc(64),
]);

/** A node-fetch style response */
function res(body, { status = 200, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    body: Readable.from([body]),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_URL = "https://integration.example";
  hostReusableFileMock.mockReturnValue("tok");
});

describe("sniffImageType", () => {
  test("recognizes real photos", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
  });

  test("refuses a page or script renamed to .jpg", () => {
    expect(sniffImageType(Buffer.from("<html><script>alert(1)</script>"))).toBe(
      null,
    );
  });
});

describe("isPrivateAddress", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("%s is private", (a) => expect(isPrivateAddress(a)).toBe(true));

  test.each(["8.8.8.8", "34.200.1.1", "172.32.0.1", "2606:4700::1111"])(
    "%s is public",
    (a) => expect(isPrivateAddress(a)).toBe(false),
  );
});

describe("downloadImage", () => {
  test("downloads and identifies a photo", async () => {
    fetchMock.mockResolvedValue(res(JPEG));
    const out = await downloadImage("https://example.com/a.jpg");
    expect(out.contentType).toBe("image/jpeg");
    expect(out.buffer.length).toBe(JPEG.length);
  });

  test("refuses a file that is not a photo", async () => {
    fetchMock.mockResolvedValue(res(Buffer.from("<html>nope</html>......")));
    await expect(downloadImage("https://example.com/a.jpg")).rejects.toThrow(
      "Not a supported photo",
    );
  });

  test("refuses a file declared too large without reading it", async () => {
    fetchMock.mockResolvedValue(
      res(JPEG, { headers: { "content-length": String(20 * 1024 * 1024) } }),
    );
    await expect(downloadImage("https://example.com/a.jpg")).rejects.toThrow(
      "too large",
    );
  });

  test("refuses a body that grows past the limit", async () => {
    fetchMock.mockResolvedValue(res(Buffer.alloc(9 * 1024 * 1024, 0xff)));
    await expect(downloadImage("https://example.com/a.jpg")).rejects.toThrow(
      "too large",
    );
  });

  test("follows a redirect and checks the next hop", async () => {
    fetchMock
      .mockResolvedValueOnce(
        res(Buffer.alloc(0), {
          status: 302,
          headers: { location: "https://cdn.example.com/a.png" },
        }),
      )
      .mockResolvedValueOnce(res(PNG));
    const out = await downloadImage("https://example.com/a.jpg");
    expect(out.contentType).toBe("image/png");
    expect(fetchMock.mock.calls[1][0].href).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  test("refuses a redirect to http or to a private address", async () => {
    fetchMock.mockResolvedValue(
      res(Buffer.alloc(0), {
        status: 302,
        headers: { location: "http://example.com/a.jpg" },
      }),
    );
    await expect(downloadImage("https://example.com/a.jpg")).rejects.toThrow(
      "Only https",
    );

    fetchMock.mockResolvedValue(
      res(Buffer.alloc(0), {
        status: 302,
        headers: { location: "https://169.254.169.254/latest" },
      }),
    );
    await expect(downloadImage("https://example.com/a.jpg")).rejects.toThrow(
      "private",
    );
  });

  test("gives up after too many redirects", async () => {
    fetchMock.mockImplementation(async () =>
      res(Buffer.alloc(0), {
        status: 302,
        headers: { location: "https://example.com/again" },
      }),
    );
    await expect(downloadImage("https://example.com/a.jpg")).rejects.toThrow(
      "Too many redirects",
    );
  });
});

describe("hostBookingImages", () => {
  test("hosts each photo and gives Jobber a link with an extension", async () => {
    fetchMock.mockResolvedValue(res(JPEG));
    const out = await hostBookingImages(["https://example.com/a.jpg"]);
    expect(out).toEqual({
      urls: ["https://integration.example/media/tok/photo-1.jpg"],
      failed: 0,
    });
  });

  test("skips a photo that fails and keeps the rest", async () => {
    fetchMock
      .mockResolvedValueOnce(res(Buffer.alloc(0), { status: 404 }))
      .mockResolvedValueOnce(res(PNG));
    const out = await hostBookingImages([
      "https://example.com/gone.jpg",
      "https://example.com/b.png",
    ]);
    expect(out.failed).toBe(1);
    expect(out.urls).toEqual([
      "https://integration.example/media/tok/photo-2.png",
    ]);
  });
});
