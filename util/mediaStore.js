import crypto from "crypto";

const TTL_MS = 5 * 60 * 1000; // 5 minutes

const store = new Map();

/**
 * Stores a file buffer in memory and returns a one-time token to retrieve it.
 * The file is automatically evicted after TTL_MS milliseconds.
 * @param {Buffer} buffer The raw file bytes
 * @param {string} contentType The MIME type (e.g. "image/png")
 * @returns {string} A random hex token used to retrieve the file
 */
export function hostFile(buffer, contentType) {
  const token = crypto.randomBytes(16).toString("hex");
  store.set(token, { buffer, contentType });
  setTimeout(() => store.delete(token), TTL_MS);
  return token;
}

/**
 * Retrieves and removes a file from the store (one-time use).
 * @param {string} token The token returned by hostFile
 * @returns {{ buffer: Buffer, contentType: string } | null}
 */
export function getFile(token) {
  const entry = store.get(token);
  if (!entry) return null;
  store.delete(token);
  return entry;
}

const BOOKING_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Stores a file that can be fetched more than once until it expires, for a
 * service that may check the link before downloading it.
 * @param {Buffer} buffer The raw file bytes
 * @param {string} contentType The MIME type
 * @param {number} [ttlMs] How long it stays available
 * @returns {string} A random hex token used to retrieve the file
 */
export function hostReusableFile(buffer, contentType, ttlMs = BOOKING_TTL_MS) {
  const token = crypto.randomBytes(16).toString("hex");
  reusable.set(token, { buffer, contentType });
  setTimeout(() => reusable.delete(token), ttlMs).unref();
  return token;
}

const reusable = new Map();

/**
 * Retrieves a reusable file without removing it.
 * @param {string} token The token returned by hostReusableFile
 * @returns {{ buffer: Buffer, contentType: string } | null}
 */
export function peekReusableFile(token) {
  return reusable.get(token) ?? null;
}

/**
 * Forgets a reusable file now, instead of waiting for it to expire.
 * @param {string} token The token returned by hostReusableFile
 */
export function deleteReusableFile(token) {
  reusable.delete(token);
}
