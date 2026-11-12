import crypto from "crypto";
import * as Sentry from "@sentry/node";
import events from "../events.js";
import Contact, { AI_AGENT_REQUEST_TITLE } from "../contact.js";
import * as APICoordinator from "../APICoordinator.js";
import { toE164 } from "../DataUtilities.js";
import {
  addRequestNote,
  createServiceRequest,
  getRequestAttachmentNames,
  getRequestForUpdate,
} from "./Jobber.js";
import {
  hostBookingImages,
  hostPhoto,
  MAX_IMAGE_BYTES,
  sniffImageType,
} from "./BookingImages.js";
import { deleteReusableFile } from "../mediaStore.js";

/**
 * Service requests from AI agents and other API clients (POST
 * /website/bookingRequest). reCAPTCHA can't be used for agents, so the request
 * is checked, screened for solicitations and rate-limited instead. A valid
 * request becomes a Jobber work request, never a scheduled visit, and staff
 * confirm the time and the service area.
 */

export const OFFICE_PHONE_DISPLAY = "(770) 914-3877";
export const EMERGENCY_PHONE = "+1-770-914-3877";
const OFFICE_EMAIL = "info@plumb-all.com";

export const SERVICE_CATEGORIES = ["plumbing", "septic"];
export const SERVICES = [
  "drain_cleaning",
  "water_heater",
  "leak_detection",
  "sewer_line",
  "backflow",
  "septic_pumping",
  "septic_repair",
  "septic_inspection",
  "other_plumbing",
  "other_septic",
];
export const WINDOW_PERIODS = ["morning", "afternoon", "any"];

const ALLOWED_FIELDS = [
  "name",
  "phone",
  "email",
  "address",
  "service_category",
  "service",
  "description",
  "additional_context",
  "image_urls",
  "preferred_window",
  "is_emergency",
  "sms_consent",
  "service_area_confirmed",
  "acting_on_behalf_of_customer",
  "idempotency_key",
  "source",
];

/** Well-known AI services, matched against the caller's `source` */
const AI_SERVICES = [
  [/claude|anthropic/i, "Claude"],
  [/openai|chatgpt|gpt|codex|\bo[1-9]\b/i, "OpenAI"],
  [/gemini|bard|google/i, "Gemini"],
  [/copilot|microsoft|bing/i, "Copilot"],
  [/perplexity/i, "Perplexity"],
  [/grok|\bxai\b/i, "Grok"],
  [/\bmeta\b|llama/i, "Meta AI"],
  [/mistral/i, "Mistral"],
  [/deepseek/i, "DeepSeek"],
  [/siri|alexa/i, "Voice assistant"],
];

/**
 * Names the AI service that sent a request, from the caller's `source`.
 * Unrecognized sources are kept as the caller wrote them.
 * @param {string|null} source
 * @returns {string}
 */
export function agentLabel(source) {
  if (!source) return "unknown";
  const known = AI_SERVICES.find(([re]) => re.test(source));
  return known ? known[1] : source;
}

const MAX_DESCRIPTION = 2000;
const MAX_IMAGES = 5;
const MAX_IMAGE_URL = 2000;

/**
 * Whether a string is a public https link. Private hosts are refused so a
 * link in a staff note can't point at our own network.
 * @param {string} value
 * @returns {boolean}
 */
function isPublicHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || !host.includes(".")) {
    return false;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) {
    return false;
  }
  return true;
}
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const IP_LIMIT_PER_HOUR = 5;
const PHONE_LIMIT_PER_DAY = 2;

/** Idempotency key -> promise of the original {httpStatus, body}, kept 24h */
const idempotent = new Map();
/** IP -> timestamps of requests that passed validation */
const ipHits = new Map();
/** E.164 phone -> timestamps of requests that passed validation */
const phoneHits = new Map();
/** Phone and normalized address of accepted requests -> when */
const recentPhones = new Map();
const recentAddresses = new Map();

let rejectedCount = 0;

/**
 * Forgets everything the limiters remember
 */
export function resetBookingState() {
  idempotent.clear();
  ipHits.clear();
  phoneHits.clear();
  recentPhones.clear();
  recentAddresses.clear();
  additionHits.clear();
  rejectedCount = 0;
}

/** Drops entries older than their window so the maps stay small */
function prune(now) {
  for (const [key, entry] of idempotent) {
    if (now - entry.at > DAY_MS) idempotent.delete(key);
  }
  for (const [map, windowMs] of [
    [ipHits, HOUR_MS],
    [phoneHits, DAY_MS],
  ]) {
    for (const [key, stamps] of map) {
      const kept = stamps.filter((t) => now - t < windowMs);
      if (kept.length) map.set(key, kept);
      else map.delete(key);
    }
  }
  for (const map of [recentPhones, recentAddresses]) {
    for (const [key, at] of map) {
      if (now - at > DAY_MS) map.delete(key);
    }
  }
}

/**
 * Records a hit and reports whether the limit was already reached
 * @returns {boolean} true when over the limit
 */
function hitLimit(map, key, limit, windowMs, now) {
  const stamps = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  if (stamps.length >= limit) {
    map.set(key, stamps);
    return true;
  }
  stamps.push(now);
  map.set(key, stamps);
  return false;
}

/**
 * Splits "street, city, ST 12345" into the parts Jobber wants
 * @param {string} address
 * @returns {{street1: string, city: string, province: string, postalCode: string}|null}
 */
export function parseAddress(address) {
  const match = address
    .trim()
    .match(/^(.+?),\s*([^,]+?),\s*([A-Za-z]{2})\.?,?\s+(\d{5})(?:-\d{4})?$/);
  if (!match) return null;
  return {
    street1: match[1].trim(),
    city: match[2].trim(),
    province: match[3].toUpperCase(),
    postalCode: match[4],
  };
}

/** Whether a phone number is an obvious placeholder */
function isJunkPhone(e164) {
  const national = e164.slice(-10);
  return (
    /^\d{3}555(01\d\d)$/.test(national) ||
    /^(\d)\1{9}$/.test(national) ||
    national === "1234567890" ||
    national.startsWith("0") ||
    national.startsWith("1")
  );
}

const isString = (v) => typeof v === "string";

/**
 * Checks the body field by field
 * @param {unknown} body
 * @returns {{errors: Record<string, string>, value: object|null}}
 */
export function validateBooking(body) {
  const errors = {};
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { errors: { body: "Send a JSON object." }, value: null };
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.includes(key)) errors[key] = "Unknown field.";
  }

  const text = (field, { required, max }) => {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === "") {
      if (required) errors[field] = "Required.";
      return null;
    }
    if (!isString(raw)) {
      errors[field] = "Must be a string.";
      return null;
    }
    const trimmed = raw.trim();
    if (!trimmed && required) errors[field] = "Required.";
    if (trimmed.length > max) {
      errors[field] = `Must be at most ${max} characters.`;
      return null;
    }
    return trimmed || null;
  };

  const name = text("name", { required: true, max: 200 });
  const email = text("email", { required: false, max: 254 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Not a valid email address.";
  }

  let phone = null;
  const rawPhone = text("phone", { required: true, max: 40 });
  if (rawPhone) {
    phone = toE164(rawPhone);
    if (!phone) errors.phone = "Not a valid US phone number.";
    else if (isJunkPhone(phone)) errors.phone = "Not a real phone number.";
  }

  let address = null;
  const rawAddress = text("address", { required: true, max: 300 });
  if (rawAddress) {
    address = parseAddress(rawAddress);
    if (!address) {
      errors.address =
        'Use the full street address, city, state and ZIP, e.g. "218 N McDonough St, Jonesboro, GA 30236".';
    }
  }

  const category = body.service_category;
  if (category === undefined || category === null) {
    errors.service_category = "Required.";
  } else if (!SERVICE_CATEGORIES.includes(category)) {
    errors.service_category = `Must be one of: ${SERVICE_CATEGORIES.join(", ")}.`;
  }

  let service = null;
  if (body.service !== undefined && body.service !== null) {
    if (!SERVICES.includes(body.service)) {
      errors.service = `Must be one of: ${SERVICES.join(", ")}.`;
    } else {
      service = body.service;
    }
  }

  const description = text("description", {
    required: true,
    max: MAX_DESCRIPTION,
  });
  if (description && description.length < 10) {
    errors.description = "Describe what the customer needs done.";
  }

  const additionalContext = text("additional_context", {
    required: false,
    max: MAX_DESCRIPTION,
  });

  let imageUrls = [];
  if (body.image_urls !== undefined && body.image_urls !== null) {
    const urls = body.image_urls;
    if (!Array.isArray(urls) || urls.length > MAX_IMAGES) {
      errors.image_urls = `Must be a list of at most ${MAX_IMAGES} https links.`;
    } else if (
      !urls.every(
        (u) => isString(u) && u.length <= MAX_IMAGE_URL && isPublicHttpsUrl(u),
      )
    ) {
      errors.image_urls =
        "Every item must be a public https link to a photo the customer already took.";
    } else {
      imageUrls = urls.map((u) => u.trim());
    }
  }

  let preferredWindow = null;
  if (body.preferred_window !== undefined && body.preferred_window !== null) {
    const w = body.preferred_window;
    if (typeof w !== "object" || Array.isArray(w)) {
      errors.preferred_window = "Must be an object with date and period.";
    } else {
      const extra = Object.keys(w).filter(
        (k) => !["date", "period"].includes(k),
      );
      const dateOk =
        isString(w.date) &&
        /^\d{4}-\d{2}-\d{2}$/.test(w.date) &&
        !Number.isNaN(Date.parse(`${w.date}T00:00:00Z`));
      if (extra.length || !dateOk || !WINDOW_PERIODS.includes(w.period)) {
        errors.preferred_window = `Must be {"date": "YYYY-MM-DD", "period": ${WINDOW_PERIODS.map((p) => `"${p}"`).join(" | ")}}.`;
      } else {
        preferredWindow = { date: w.date, period: w.period };
      }
    }
  }

  if (
    body.is_emergency !== undefined &&
    body.is_emergency !== null &&
    typeof body.is_emergency !== "boolean"
  ) {
    errors.is_emergency = "Must be true or false.";
  }
  if (typeof body.sms_consent !== "boolean") {
    errors.sms_consent =
      "Required, true or false. Only true if the customer agreed to receive texts.";
  }
  if (body.service_area_confirmed !== true) {
    errors.service_area_confirmed =
      "Must be true. Confirm the customer's address is within about 30 miles of Jonesboro, GA, or ask the customer to call the office instead.";
  }
  if (body.acting_on_behalf_of_customer !== true) {
    errors.acting_on_behalf_of_customer =
      "Must be true. Only submit a real customer's request for service from Plumb-All.";
  }

  const idempotencyKey = text("idempotency_key", { required: false, max: 128 });
  const source = text("source", { required: false, max: 64 });
  if (source && !/^[\w .:/@-]+$/.test(source)) {
    errors.source = "Use letters, numbers and . _ - : / @ only.";
  }

  if (Object.keys(errors).length) return { errors, value: null };

  return {
    errors,
    value: {
      name,
      phone,
      email,
      address,
      addressText: rawAddress,
      category,
      service,
      description,
      additionalContext,
      imageUrls,
      preferredWindow,
      isEmergency: body.is_emergency === true,
      smsConsent: body.sms_consent,
      idempotencyKey,
      source,
    },
  };
}

/** Pitches that are never a customer, whatever else the text says */
const ALWAYS_NOT_SERVICE = [
  /\b(buy|purchase|acquire|acquisition of|invest(ing)? in)\b.{0,40}\b(your|the)\b.{0,20}\b(business|company)\b/i,
  /\bsell(ing)?\b.{0,20}\byour\b.{0,20}\b(business|company)\b/i,
  /\b(acquisition|investment|investor|merger)\b.{0,60}\b(opportunit|offer|inquir|proposal|interest)/i,
];

/** Pitches that still pass when the text is clearly about a plumbing or septic job */
const USUALLY_NOT_SERVICE = [
  /\b(seo|search engine optimi[sz]ation|backlinks?|guest post|link building|rank(ing)? (higher|#?1)|google ranking)\b/i,
  /\b(lead generation|generate (more )?leads|web ?site design|web design|social media (management|marketing)|digital marketing|marketing (services|agency|campaign))\b/i,
  /\b(partnership|partner with|collaborat(e|ion)|joint venture|business proposal|affiliate program|referral program)\b/i,
  /\bwe (can|could|would like to|offer to|provide|specialize in|are a)\b.{0,60}\b(clean(ing)?|staffing|software|payroll|insurance|financing|accounting|printing|uniforms?|advertis)/i,
  /\b(job application|apply for (a |the )?(position|job)|looking for (a )?(job|employment|work opportunit)|my (resume|r[ée]sum[ée])|cover letter|are you hiring)\b/i,
  /\b(dear (sir|madam|business owner|owner)|to whom it may concern|unsubscribe|reply stop to opt out)\b/i,
];

const PLUMBING_HINT =
  /\b(plumb|pipe|drain|toilet|sink|faucet|shower|tub|water heater|sewer|septic|leak|clog|backed up|disposal|sump|backflow|hose bib|spigot|valve|pressure|tank|grease trap|hydro ?jet|camera inspection|low water|no (hot )?water)/i;

/**
 * Whether the text is a sales or business pitch rather than a request for
 * plumbing or septic service. Errs toward letting a plausible job through.
 * @param {string} description
 * @param {string} name
 * @returns {boolean}
 */
export function isNotServiceRequest(description, name = "") {
  const text = `${name}\n${description}`;
  if (ALWAYS_NOT_SERVICE.some((re) => re.test(text))) return true;

  const links = (description.match(/https?:\/\/|www\./gi) ?? []).length;
  const pitch = USUALLY_NOT_SERVICE.some((re) => re.test(text)) || links >= 3;
  return pitch && !PLUMBING_HINT.test(description);
}

const EMERGENCY_PATTERNS = [
  /\b(burst|broken|busted|ruptured) (water )?(pipe|line|main)\b/i,
  /\b(pipe|line|main) (has |just )?(burst|broke|ruptured)\b/i,
  /\b(sewage|sewer|septic|raw sewage)\b.{0,40}\b(back(ing|ed)? (up|into)|coming up|overflow|in (the|my) (house|home|basement)|flood)/i,
  /\bno (running )?water\b/i,
  /\b(gas smell|smell(s|ing)? (of )?gas|smell gas|gas leak)\b/i,
  /\b(flooding|flooded|water (is )?(pouring|gushing|everywhere))\b/i,
];

/** Whether the description clearly describes an emergency */
export function looksLikeEmergency(description) {
  return EMERGENCY_PATTERNS.some((re) => re.test(description));
}

/** Normalizes an address for the duplicate check */
function addressKey(address) {
  return `${address.street1} ${address.postalCode}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function respond(httpStatus, body) {
  return { httpStatus, body };
}

function notService() {
  return respond(200, {
    status: "not_a_service_request",
    message: `This endpoint is only for requesting plumbing or septic service. For other inquiries, please contact the office at ${OFFICE_PHONE_DISPLAY} or ${OFFICE_EMAIL}.`,
  });
}

/**
 * Builds the Jobber request note and the Slack text. Only the Jobber note
 * names the AI service.
 */
function describeRequest(
  v,
  { urgent, jobberUrl, includeAgent = false, photoLinks = [] },
) {
  const lines = [
    urgent ? "URGENT: customer reports an emergency." : null,
    `Service category: ${v.category}${v.service ? ` (${v.service})` : ""}`,
    `Description: ${v.description}`,
    v.additionalContext
      ? `Additional context from the AI agent: ${v.additionalContext}`
      : null,
    photoLinks.length
      ? `Photos the customer already took:\n${photoLinks.join("\n")}`
      : null,
    v.preferredWindow
      ? `Preferred window (a preference, not a booking): ${v.preferredWindow.date}, ${v.preferredWindow.period}`
      : null,
    `Texts allowed: ${v.smsConsent ? "yes" : "no"}`,
    includeAgent
      ? `Submitted by an AI agent / API client: ${agentLabel(v.source)}${v.source && agentLabel(v.source) !== v.source ? ` (reported as "${v.source}")` : ""}`
      : null,
    jobberUrl ? `Jobber: ${jobberUrl}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Tells staff, the same way as other contacts (Slack, PostHog and Trello)
 */
async function notifyStaff(
  v,
  { urgent, jobberUrl, jobberFailed, photos = { images: [], failedLinks: [] } },
) {
  const contact = new Contact(
    `${urgent ? "URGENT " : ""}AI Agent Booking Request`,
    v.name,
    v.phone,
    undefined,
    v.email ?? undefined,
    v.addressText,
    describeRequest(v, {
      urgent,
      jobberUrl,
      // Photos that downloaded are attached in Slack; only the rest need a link
      photoLinks: photos.failedLinks,
    }) +
      (jobberFailed
        ? "\nThe Jobber request could NOT be created. Please enter it by hand."
        : ""),
    "AI Agent",
  );
  contact.images = photos.images;
  // The Jobber webhook skips these requests, so this is staff's only notice
  APICoordinator.contactMade(contact, JSON.stringify({ source: v.source }));
}

async function submitRequest(v) {
  const urgent = v.isEmergency || looksLikeEmergency(v.description);
  const label = agentLabel(v.source);
  const title = `${urgent ? "URGENT: " : ""}${AI_AGENT_REQUEST_TITLE} (${label}): ${v.category}${v.service ? ` - ${v.service.replace(/_/g, " ")}` : ""}`;

  // Best effort: a photo that can't be fetched stays a link in the note
  const photos = v.imageUrls.length
    ? await hostBookingImages(v.imageUrls)
    : { urls: [], images: [], failedLinks: [] };

  let created;
  try {
    created = await createServiceRequest({
      attachmentUrls: photos.urls,
      name: v.name,
      phone: v.phone,
      email: v.email,
      address: v.address,
      smsAllowed: v.smsConsent,
      title,
      note: describeRequest(v, {
        urgent,
        jobberUrl: null,
        includeAgent: true,
        photoLinks: v.imageUrls,
      }),
      sourceText: `AI agent: ${label}`,
      details: [
        {
          label: "Please provide as much information as you can",
          answerText: v.description,
        },
        ...(v.additionalContext
          ? [
              {
                label:
                  "Additional context from the AI agent (symptoms, diagnostics already done)",
                answerText: v.additionalContext,
              },
            ]
          : []),
        ...(v.imageUrls.length
          ? [
              {
                label: "Share images of the work to be done",
                answerText: "In notes",
              },
            ]
          : []),
        {
          label: "How did you hear about us?",
          answerText: `AI agent: ${label}`,
        },
      ],
    });
  } catch (e) {
    Sentry.captureException(e);
    console.error("BookingRequest: Failed to create the Jobber request:", e);
    // The customer's details are not lost: staff get them in Slack
    discardHosted(photos.tokens ?? []);
    await notifyStaff(v, {
      urgent,
      jobberUrl: null,
      jobberFailed: true,
      photos,
    });
    return respond(500, {
      status: "error",
      message: `We could not record this request. Staff have been notified, but please also ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
      emergency_phone: EMERGENCY_PHONE,
    });
  }

  await notifyStaff(v, { urgent, jobberUrl: created.url, photos });
  if (created.attached) {
    // In the background: the caller shouldn't wait for this
    releaseWhenAttached({
      requestId: created.requestId,
      tokens: photos.tokens ?? [],
      filenames: photos.filenames ?? [],
    });
  } else {
    discardHosted(photos.tokens ?? []);
  }
  console.log(
    `BookingRequest: Created Jobber request ${created.requestId}${urgent ? " (urgent)" : ""} from ${v.source ?? "unknown source"}`,
  );

  const now = Date.now();
  recentPhones.set(v.phone, now);
  recentAddresses.set(addressKey(v.address), now);

  const updateToken = issueUpdateToken(created.requestId);
  return respond(201, {
    status: "received",
    request_id: created.requestId,
    ...(updateToken
      ? {
          update_token: updateToken,
          update_url: `${process.env.WEB_URL}/website/bookingRequest/${encodeURIComponent(created.requestId)}/additions`,
          update_note:
            "If the customer has photos of the issue or more details, add them: POST JSON with update_token and image_urls (public https links) and/or additional_context to update_url, or, if you have the photo file itself, POST its raw bytes (Content-Type: image/jpeg, image/png, etc., 8 MB max) to update_url with /additions replaced by /photos and the update_token in an X-Update-Token header. Only send photos the customer already has.",
        }
      : {}),
    message: urgent
      ? "Request received and flagged urgent. Like every request here, it went straight to Plumb-All dispatch to be assigned to a technician, and a team member will contact the customer to confirm the time and the service area. Calling the office is not faster."
      : "Request received. It went straight to Plumb-All dispatch to be assigned to a technician, and a team member will contact the customer to confirm the time and the service area. Calling the office is not faster.",
    expected_followup: urgent
      ? "As soon as dispatch can assign a technician"
      : "Same business day during office hours (Mon-Fri 8am-4pm)",
    emergency_phone: EMERGENCY_PHONE,
    ...(urgent ? { urgent: true } : {}),
    ...(v.imageUrls.length
      ? { images_attached: created.attached ? photos.urls.length : 0 }
      : {}),
  });
}

/**
 * Deletes the temporary copies of photos from memory once Jobber has fetched
 * them. Jobber attaches them while the note is created, but this checks for
 * the files rather than assuming, and the copies expire on their own if it
 * never sees them. Never throws.
 * @param {object} params
 * @param {string} params.requestId The Jobber request id
 * @param {string[]} params.tokens The hosted file tokens
 * @param {string[]} params.filenames The names those files were given
 */
export async function releaseWhenAttached({ requestId, tokens, filenames }) {
  if (!tokens.length) return;
  try {
    for (let attempt = 0; attempt < 15; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1000));
      const names = await getRequestAttachmentNames(requestId);
      if (filenames.every((f) => names.includes(f))) {
        tokens.forEach((t) => deleteReusableFile(t));
        return;
      }
    }
  } catch (e) {
    Sentry.captureException(e);
    console.error("BookingRequest: Failed to confirm photos attached:", e);
  }
}

/** Forgets the temporary copies without waiting, when Jobber won't take them */
function discardHosted(tokens) {
  tokens.forEach((t) => deleteReusableFile(t));
}

/**
 * Handles one booking request, start to finish.
 * @param {unknown} body The parsed JSON body
 * @param {string} ip The caller's IP address
 * @returns {Promise<{httpStatus: number, body: object}>}
 */
export async function handleBookingRequest(body, ip) {
  const { errors, value: v } = validateBooking(body);
  if (!v) {
    return respond(422, {
      status: "invalid_request",
      message: "The request was not valid. Fix the fields below and try again.",
      errors,
    });
  }

  const now = Date.now();
  prune(now);

  if (v.idempotencyKey) {
    const earlier = idempotent.get(v.idempotencyKey);
    if (earlier) return earlier.result;
  }

  if (
    hitLimit(ipHits, ip, IP_LIMIT_PER_HOUR, HOUR_MS, now) ||
    hitLimit(phoneHits, v.phone, PHONE_LIMIT_PER_DAY, DAY_MS, now)
  ) {
    return respond(429, {
      status: "rate_limited",
      message: `Too many requests. Please try again later, or ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
    });
  }

  if (isNotServiceRequest(v.description, v.name)) {
    rejectedCount++;
    console.log(
      `BookingRequest: Rejected a non-service request (${rejectedCount} so far)`,
    );
    return notService();
  }

  if (recentPhones.has(v.phone) || recentAddresses.has(addressKey(v.address))) {
    return respond(200, {
      status: "duplicate",
      message: `A request for this phone number or address was already received in the last 24 hours. A Plumb-All team member will be in touch. For anything urgent, call ${OFFICE_PHONE_DISPLAY}.`,
      emergency_phone: EMERGENCY_PHONE,
    });
  }

  // Held while it runs so a retry with the same key doesn't create a second request
  const pending = submitRequest(v);
  if (v.idempotencyKey) {
    const entry = { at: now, result: pending };
    idempotent.set(v.idempotencyKey, entry);
    pending.then((r) => {
      if (r.httpStatus >= 500) idempotent.delete(v.idempotencyKey);
    });
  }
  return pending;
}

/**
 * The secret a caller needs to add to a request it made. Derived from the
 * request id, so it survives restarts and nothing is stored.
 * @returns {string|null} null when no secret is configured
 */
function updateKey() {
  return (
    process.env.BOOKING_UPDATE_SECRET || process.env.JOBBER_APP_SECRET || null
  );
}

/**
 * @param {string} requestId The Jobber request id
 * @returns {string|null} The token returned with the 201, or null when no secret is configured
 */
export function issueUpdateToken(requestId) {
  const key = updateKey();
  if (!key) return null;
  return crypto
    .createHmac("sha256", key)
    .update(`booking-update:${requestId}`)
    .digest("base64url");
}

function tokenMatches(requestId, token) {
  const expected = issueUpdateToken(requestId);
  if (!expected || !isString(token)) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Loads a request for an addition, checking it is one the booking API made and
 * that staff haven't started on it.
 * @param {string} requestId
 * @param {{httpStatus: number, body: object}} notFound The response for a missing or foreign request
 * @returns {Promise<{request?: object, response?: {httpStatus: number, body: object}}>}
 */
async function loadEditableRequest(requestId, notFound) {
  let request;
  try {
    request = await getRequestForUpdate(requestId);
  } catch (e) {
    Sentry.captureException(e);
    console.error("BookingRequest: Failed to read the request to update:", e);
    return {
      response: respond(500, {
        status: "error",
        message: `We could not record this update. Please ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
      }),
    };
  }
  if (!request || !request.title.includes(AI_AGENT_REQUEST_TITLE)) {
    return { response: notFound };
  }
  if (request.status.toLowerCase() !== "new") {
    return {
      response: respond(409, {
        status: "no_longer_editable",
        message: `A team member is already working on this request, so it can't be changed here. Please ask the customer to tell them directly, or call the office at ${OFFICE_PHONE_DISPLAY}.`,
      }),
    };
  }
  return { request };
}

const ADDITION_FIELDS = [
  "update_token",
  "additional_context",
  "image_urls",
  "idempotency_key",
];
const ADDITIONS_PER_REQUEST_PER_DAY = 10;
const ADDITIONS_PER_IP_PER_HOUR = 20;
const additionHits = new Map();

/**
 * Checks the body of an addition
 * @param {unknown} body
 * @returns {{errors: Record<string, string>, value: object|null}}
 */
export function validateAddition(body) {
  const errors = {};
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { errors: { body: "Send a JSON object." }, value: null };
  }
  for (const key of Object.keys(body)) {
    if (!ADDITION_FIELDS.includes(key)) errors[key] = "Unknown field.";
  }
  if (!isString(body.update_token) || !body.update_token) {
    errors.update_token = "Required. Use the update_token from the 201.";
  }

  let additionalContext = null;
  if (
    body.additional_context !== undefined &&
    body.additional_context !== null
  ) {
    if (
      !isString(body.additional_context) ||
      body.additional_context.trim().length > MAX_DESCRIPTION
    ) {
      errors.additional_context = `Must be a string of at most ${MAX_DESCRIPTION} characters.`;
    } else {
      additionalContext = body.additional_context.trim() || null;
    }
  }

  let imageUrls = [];
  if (body.image_urls !== undefined && body.image_urls !== null) {
    const urls = body.image_urls;
    if (
      !Array.isArray(urls) ||
      urls.length > MAX_IMAGES ||
      !urls.every(
        (u) => isString(u) && u.length <= MAX_IMAGE_URL && isPublicHttpsUrl(u),
      )
    ) {
      errors.image_urls = `Must be a list of at most ${MAX_IMAGES} public https links to photos.`;
    } else {
      imageUrls = urls.map((u) => u.trim());
    }
  }

  if (
    !additionalContext &&
    !imageUrls.length &&
    !errors.additional_context &&
    !errors.image_urls
  ) {
    errors.additional_context = "Send additional_context, image_urls, or both.";
  }

  let idempotencyKey = null;
  if (body.idempotency_key !== undefined && body.idempotency_key !== null) {
    if (!isString(body.idempotency_key) || body.idempotency_key.length > 128) {
      errors.idempotency_key = "Must be a string of at most 128 characters.";
    } else {
      idempotencyKey = body.idempotency_key.trim() || null;
    }
  }

  if (Object.keys(errors).length) return { errors, value: null };
  return {
    errors,
    value: {
      token: body.update_token,
      additionalContext,
      imageUrls,
      idempotencyKey,
    },
  };
}

/**
 * Adds information the caller learned later (more context, photos) to a
 * request it made. Only a note is added: nothing already on the request is
 * changed, and only while the request is still new.
 * @param {string} requestId The Jobber request id from the 201
 * @param {unknown} body The parsed JSON body
 * @param {string} ip The caller's IP address
 * @returns {Promise<{httpStatus: number, body: object}>}
 */
export async function handleBookingAddition(requestId, body, ip) {
  const { errors, value: v } = validateAddition(body);
  if (!v) {
    return respond(422, {
      status: "invalid_request",
      message: "The request was not valid. Fix the fields below and try again.",
      errors,
    });
  }

  if (!updateKey()) {
    return respond(503, {
      status: "error",
      message: `Updates are unavailable right now. Please ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
    });
  }

  const now = Date.now();
  prune(now);
  // The same answer for a wrong token and a wrong id, so ids can't be probed
  const notFound = respond(404, {
    status: "not_found",
    message: `We could not find that request. Check the request_id and update_token from the original response, or ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
  });
  if (
    hitLimit(additionHits, `ip:${ip}`, ADDITIONS_PER_IP_PER_HOUR, HOUR_MS, now)
  ) {
    return respond(429, {
      status: "rate_limited",
      message: `Too many requests. Please try again later, or ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
    });
  }
  if (!tokenMatches(requestId, v.token)) return notFound;

  if (v.idempotencyKey) {
    const earlier = idempotent.get(`add:${requestId}:${v.idempotencyKey}`);
    if (earlier) return earlier.result;
  }
  if (
    hitLimit(
      additionHits,
      `req:${requestId}`,
      ADDITIONS_PER_REQUEST_PER_DAY,
      DAY_MS,
      now,
    )
  ) {
    return respond(429, {
      status: "rate_limited",
      message: `This request has had too many updates today. Please ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
    });
  }

  const run = async () => {
    const loaded = await loadEditableRequest(requestId, notFound);
    if (loaded.response) return loaded.response;
    const { request } = loaded;

    const photos = v.imageUrls.length
      ? await hostBookingImages(v.imageUrls)
      : { urls: [], images: [], failedLinks: [] };
    const note = [
      "Update from the AI agent:",
      v.additionalContext ? `Additional context: ${v.additionalContext}` : null,
      v.imageUrls.length
        ? `Photos the customer already took:\n${v.imageUrls.join("\n")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    let attached = false;
    try {
      ({ attached } = await addRequestNote({
        requestId,
        note,
        attachmentUrls: photos.urls,
      }));
      if (attached) {
        releaseWhenAttached({
          requestId,
          tokens: photos.tokens ?? [],
          filenames: photos.filenames ?? [],
        });
      } else {
        discardHosted(photos.tokens ?? []);
      }
    } catch (e) {
      discardHosted(photos.tokens ?? []);
      Sentry.captureException(e);
      console.error("BookingRequest: Failed to add the update note:", e);
      return respond(500, {
        status: "error",
        message: `We could not record this update. Please ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
      });
    }

    // Slack only: this isn't a new contact, so no new Trello card or PostHog event
    const contact = new Contact(
      "AI Agent Booking Update",
      request.name ?? "Unknown",
      request.phone ?? undefined,
      undefined,
      undefined,
      request.address ?? undefined,
      [
        v.additionalContext
          ? `Additional context: ${v.additionalContext}`
          : null,
        photos.failedLinks.length
          ? `Photos that couldn't be attached:\n${photos.failedLinks.join("\n")}`
          : null,
        request.url ? `Jobber: ${request.url}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      "AI Agent",
    );
    contact.images = photos.images;
    events.emit("slackbot-send-contact", contact, "AI Agent Booking Update");

    console.log(
      `BookingRequest: Added an update to Jobber request ${requestId}`,
    );
    return respond(200, {
      status: "updated",
      request_id: requestId,
      message:
        "Update added. The Plumb-All team will see it with the original request.",
      ...(v.imageUrls.length
        ? { images_attached: attached ? photos.urls.length : 0 }
        : {}),
    });
  };

  const pending = run();
  if (v.idempotencyKey) {
    const key = `add:${requestId}:${v.idempotencyKey}`;
    idempotent.set(key, { at: now, result: pending });
    pending.then((r) => {
      if (r.httpStatus >= 500) idempotent.delete(key);
    });
  }
  return pending;
}

const PHOTOS_PER_REQUEST_PER_DAY = 5;

/**
 * Whether a token is the right one for a request, so the web layer can refuse
 * an upload before reading its body
 * @param {string} requestId
 * @param {unknown} token
 * @returns {boolean}
 */
export function isValidUpdateToken(requestId, token) {
  return tokenMatches(requestId, token);
}

/**
 * Adds one photo, uploaded as the raw request body, to a request the caller
 * made. The photo is sniffed (it must really be an image), attached to the
 * Jobber note and posted in the Slack thread, then dropped from memory.
 * @param {string} requestId The Jobber request id from the 201
 * @param {string} token The update_token from the 201
 * @param {Buffer} bytes The photo
 * @param {string} ip The caller's IP address
 * @returns {Promise<{httpStatus: number, body: object}>}
 */
export async function handleBookingPhoto(requestId, token, bytes, ip) {
  if (!updateKey()) {
    return respond(503, {
      status: "error",
      message: `Uploads are unavailable right now. Please ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
    });
  }

  const now = Date.now();
  prune(now);
  const notFound = respond(404, {
    status: "not_found",
    message: `We could not find that request. Check the request_id and update_token from the original response, or ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
  });
  if (
    hitLimit(additionHits, `ip:${ip}`, ADDITIONS_PER_IP_PER_HOUR, HOUR_MS, now)
  ) {
    return respond(429, {
      status: "rate_limited",
      message: `Too many requests. Please try again later, or ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
    });
  }
  if (!tokenMatches(requestId, token)) return notFound;

  if (!Buffer.isBuffer(bytes) || !bytes.length) {
    return respond(422, {
      status: "invalid_request",
      message:
        "Send the photo itself as the request body (raw bytes, not JSON or a form).",
      errors: { photo: "The body was empty." },
    });
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return respond(413, {
      status: "invalid_request",
      message: `The photo is too large. The limit is ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
      errors: { photo: "Too large." },
    });
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return respond(422, {
      status: "invalid_request",
      message:
        "The body is not a supported photo (JPEG, PNG, WebP, GIF or HEIC).",
      errors: { photo: "Not a supported photo." },
    });
  }

  if (
    hitLimit(
      additionHits,
      `photos:${requestId}`,
      PHOTOS_PER_REQUEST_PER_DAY,
      DAY_MS,
      now,
    )
  ) {
    return respond(429, {
      status: "rate_limited",
      message: `This request has had too many photos today. Please ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
    });
  }

  const loaded = await loadEditableRequest(requestId, notFound);
  if (loaded.response) return loaded.response;
  const { request } = loaded;

  const hosted = hostPhoto(bytes, contentType, 1);
  let attached = false;
  try {
    ({ attached } = await addRequestNote({
      requestId,
      note: "Photo uploaded by the AI agent (the customer already had it).",
      attachmentUrls: [hosted.url],
    }));
  } catch (e) {
    discardHosted([hosted.token]);
    Sentry.captureException(e);
    console.error("BookingRequest: Failed to add the photo note:", e);
    return respond(500, {
      status: "error",
      message: `We could not record this photo. Please ask the customer to call the office at ${OFFICE_PHONE_DISPLAY}.`,
    });
  }
  if (attached) {
    releaseWhenAttached({
      requestId,
      tokens: [hosted.token],
      filenames: [hosted.filename],
    });
  } else {
    discardHosted([hosted.token]);
  }

  // Slack only, with the photo in the thread; Slack's upload is the last holder of the bytes
  const contact = new Contact(
    "AI Agent Booking Update",
    request.name ?? "Unknown",
    request.phone ?? undefined,
    undefined,
    undefined,
    request.address ?? undefined,
    ["Photo added", request.url ? `Jobber: ${request.url}` : null]
      .filter(Boolean)
      .join("\n"),
    "AI Agent",
  );
  contact.images = [hosted.image];
  events.emit("slackbot-send-contact", contact, "AI Agent Booking Update");

  console.log(`BookingRequest: Added an uploaded photo to ${requestId}`);
  return respond(200, {
    status: "updated",
    request_id: requestId,
    message:
      "Photo added. The Plumb-All team will see it with the original request.",
    images_attached: attached ? 1 : 0,
  });
}
