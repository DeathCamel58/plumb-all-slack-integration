import dns from "dns";
import https from "https";
import net from "net";
import fetch from "node-fetch";
import * as Sentry from "@sentry/node";
import { hostReusableFile } from "../mediaStore.js";
import crypto from "crypto";

/**
 * Photos sent with a booking request. Each link is downloaded (carefully,
 * since the address comes from an untrusted caller), checked to really be a
 * photo, and hosted briefly on this server so Jobber can fetch it as a note
 * attachment.
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10 * 1000;
const MAX_REDIRECTS = 3;

/** File types Jobber shows as photos, with their extension */
const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
};

/**
 * Names the image type from the file's first bytes, so a page or script
 * renamed to .jpg is refused.
 * @param {Buffer} b
 * @returns {string|null} The MIME type
 */
export function sniffImageType(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "image/png";
  }
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    b.subarray(4, 8).toString("latin1") === "ftyp" &&
    /^(heic|heix|hevc|mif1|msf1)/.test(b.subarray(8, 12).toString("latin1"))
  ) {
    return "image/heic";
  }
  return null;
}

/**
 * Whether an IP address is one a public photo would never live at
 * @param {string} address
 * @returns {boolean}
 */
export function isPrivateAddress(address) {
  if (net.isIPv6(address)) {
    const a = address.toLowerCase();
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      a === "::1" ||
      a === "::" ||
      /^f[cd]/.test(a) ||
      /^fe[89ab]/.test(a) ||
      a.startsWith("ff")
    );
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** DNS lookup that refuses private addresses at connection time, so a name that changes its answer can't slip through */
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const ok = addresses.filter((a) => !isPrivateAddress(a.address));
    if (!ok.length) {
      return callback(new Error(`Refusing private address for ${hostname}`));
    }
    if (options.all) return callback(null, ok);
    return callback(null, ok[0].address, ok[0].family);
  });
}

const agent = new https.Agent({ lookup: safeLookup });

/**
 * Downloads one photo. Follows a few redirects, each checked again.
 * @param {string} link An https link
 * @returns {Promise<{buffer: Buffer, contentType: string}>}
 */
export async function downloadImage(link) {
  let url = new URL(link);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "https:") throw new Error("Only https links");
    if (net.isIP(url.hostname) && isPrivateAddress(url.hostname)) {
      throw new Error("Refusing private address");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        agent,
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "image/*" },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect without a location");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const declared = Number(response.headers.get("content-length"));
      if (declared > MAX_IMAGE_BYTES) throw new Error("Image too large");

      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) throw new Error("Image too large");
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const contentType = sniffImageType(buffer);
      if (!contentType) throw new Error("Not a supported photo");
      return { buffer, contentType };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}

/**
 * Hosts a photo that is already in memory (an upload, or a download) so Jobber
 * can fetch it, and names it for Slack. The name is unique so it can be found
 * on the Jobber request later.
 * @param {Buffer} buffer
 * @param {string} contentType A type from sniffImageType
 * @param {number} number Which photo this is
 * @param {string} [sourceUrl] Where it came from, if it was a link
 * @returns {{url: string, token: string, filename: string, image: {buffer: Buffer, filename: string, sourceUrl?: string}}}
 */
export function hostPhoto(buffer, contentType, number, sourceUrl) {
  const token = hostReusableFile(buffer, contentType);
  const filename = `photo-${number}-${crypto.randomBytes(3).toString("hex")}.${IMAGE_TYPES[contentType]}`;
  return {
    url: `${process.env.WEB_URL}/media/${token}/${filename}`,
    token,
    filename,
    image: { buffer, filename, sourceUrl },
  };
}

/**
 * Downloads each photo and hosts it for Jobber. A photo that can't be fetched
 * is skipped, since the request matters more than any one photo.
 * @param {string[]} links https links from the caller
 * @returns {Promise<{urls: string[], images: Array<{buffer: Buffer, filename: string, sourceUrl: string}>, failedLinks: string[]}>}
 *   urls are links Jobber can fetch; images are the files for Slack; failedLinks are the links that could not be downloaded
 */
export async function hostBookingImages(links) {
  const results = await Promise.all(
    links.map(async (link, i) => {
      try {
        const { buffer, contentType } = await downloadImage(link);
        return hostPhoto(buffer, contentType, i + 1, link);
      } catch (e) {
        // The link is still in the note, so staff can open it themselves
        console.warn(`BookingImages: Skipped a photo: ${e.message}`);
        if (!/HTTP 4\d\d|Not a supported|too large|private/i.test(e.message)) {
          Sentry.captureException(e);
        }
        return { failedLink: link };
      }
    }),
  );
  return {
    urls: results.filter((r) => r.url).map((r) => r.url),
    tokens: results.filter((r) => r.token).map((r) => r.token),
    filenames: results.filter((r) => r.filename).map((r) => r.filename),
    images: results.filter((r) => r.image).map((r) => r.image),
    failedLinks: results.filter((r) => r.failedLink).map((r) => r.failedLink),
  };
}
