/**
 * One-time script to deduplicate PostHog persons.
 *
 * Usage:
 *   ENV_LOCATION=.env_production node scripts/dedupe-posthog.mjs [--dry-run]
 *
 * What it does:
 *   1. Fetches all persons from PostHog (paginated)
 *   2. Groups them by normalized phone, email, and name
 *   3. For each group with duplicates, picks the person with the most
 *      properties as primary and merges the rest into it
 *   4. Sends $merge_dangerously events to PostHog
 *
 * --dry-run: Print what would be merged without actually merging
 */

import dotenv from "dotenv";
dotenv.config({
  path: process.env.ENV_LOCATION || ".env_production",
});

import fetch from "node-fetch";
import readline from "readline";
import { searchPlace } from "../util/apis/GoogleMaps.js";
import { normalizePhoneNumber } from "../util/DataUtilities.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const POSTHOG_HOST = process.env.POSTHOG_HOST;
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const POSTHOG_API_TOKEN = process.env.POSTHOG_API_TOKEN;
const POSTHOG_TOKEN = process.env.POSTHOG_TOKEN;

const DRY_RUN = process.argv.includes("--dry-run");

const addressCache = new Map();

/**
 * Resolve an address via Google Maps, returning the formatted_address or null.
 * Results are cached to avoid redundant API calls.
 */
async function resolveAddress(address) {
  if (!address || typeof address !== "string" || address.trim() === "") return null;

  if (addressCache.has(address)) return addressCache.get(address);

  try {
    const result = await searchPlace(address);
    const formatted = result?.[0]?.formatted_address ?? null;
    addressCache.set(address, formatted);
    return formatted;
  } catch {
    addressCache.set(address, null);
    return null;
  }
}

if (DRY_RUN) {
  console.log("=== DRY RUN MODE — no merges will be performed ===\n");
}

/**
 * Fetch all persons from PostHog, handling pagination
 */
async function fetchAllPersons() {
  let persons = [];
  let url = `${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/persons/?limit=1000`;

  let page = 0;
  while (url) {
    page++;
    console.log(`Fetching page ${page}... (${persons.length} persons so far)`);

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${POSTHOG_API_TOKEN}` },
    });

    if (!resp.ok) {
      throw new Error(`PostHog API error: ${resp.status} ${await resp.text()}`);
    }

    const data = await resp.json();
    persons.push(...data.results);
    url = data.next || null;
  }

  console.log(`Fetched ${persons.length} total persons\n`);
  return persons;
}

const NAME_PREFIXES =
  /^(mr\.?|mrs\.?|ms\.?|dr\.?|miss|sir|madam|rev\.?|prof\.?)\s+/i;

/**
 * Normalize a string for grouping (lowercase, trim, collapse whitespace)
 */
function normalize(val) {
  if (!val || typeof val !== "string") return null;
  val = val.toLowerCase().trim().replace(/\s+/g, " ");
  return val === "" ? null : val;
}

const STATE_ABBREVIATIONS = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia",
  kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md",
  massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms",
  missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv",
  "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
  "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok",
  oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi",
  wyoming: "wy",
};

// Maps full words → abbreviations. Order matters: longer words first to avoid
// partial replacements (e.g. "northwest" before "north").
const ADDRESS_NORMALIZATIONS = {
  // Directionals
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
  north: "n", south: "s", east: "e", west: "w",
  // Street types
  avenue: "ave", boulevard: "blvd", circle: "cir", court: "ct",
  crossing: "xing", drive: "dr", expressway: "expy", freeway: "fwy",
  highway: "hwy", junction: "jct", lane: "ln", loop: "lp",
  parkway: "pkwy", place: "pl", plaza: "plz", road: "rd",
  route: "rte", square: "sq", street: "st", terrace: "ter",
  trail: "trl", turnpike: "tpke", way: "way",
  // Unit types
  apartment: "apt", building: "bldg", suite: "ste", unit: "unit",
};

/**
 * Normalize a field value for comparison purposes only (not written back).
 * Lowercases, removes commas/periods, collapses whitespace, normalizes
 * state names, street types, and directionals to abbreviations.
 */
function normalizeForComparison(val) {
  if (!val || typeof val !== "string") return "";
  let result = val.toLowerCase().trim().replace(/[,.]/g, "").replace(/\s+/g, " ");
  // Replace full state names with abbreviations
  for (const [full, abbr] of Object.entries(STATE_ABBREVIATIONS)) {
    result = result.replace(new RegExp(`\\b${full}\\b`, "g"), abbr);
  }
  // Replace full street types and directionals with abbreviations
  for (const [full, abbr] of Object.entries(ADDRESS_NORMALIZATIONS)) {
    result = result.replace(new RegExp(`\\b${full}\\b`, "g"), abbr);
  }
  return result;
}

/**
 * Normalize a name for comparison: strips honorific prefixes, commas, whitespace.
 */
function normalizeNameForComparison(val) {
  if (!val || typeof val !== "string") return "";
  let name = val.toLowerCase().trim().replace(/,/g, "").replace(/\s+/g, " ");
  name = name.replace(NAME_PREFIXES, "");
  return name;
}

/**
 * Normalize a phone number to just digits for grouping
 */
function normalizePhone(val) {
  if (!val || typeof val !== "string") return null;
  let digits = val.replace(/\D/g, "");
  // Strip leading 1 for US numbers if 11 digits
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits.length >= 7 ? digits : null;
}

/**
 * Count the number of non-null/non-empty properties on a person
 */
function propertyCount(person) {
  let count = 0;
  for (const [key, val] of Object.entries(person.properties || {})) {
    if (key.startsWith("$")) continue; // skip PostHog internal props
    if (val !== null && val !== undefined && val !== "") count++;
  }
  return count;
}

/**
 * Group persons by matching keys, returning merge groups
 */
function findDuplicateGroups(persons) {
  // Build indexes: key -> Set of person indices
  const phoneIndex = new Map();
  const emailIndex = new Map();
  const nameIndex = new Map();

  for (let i = 0; i < persons.length; i++) {
    const props = persons[i].properties || {};

    const phone = normalizePhone(props.phone);
    const altPhone = normalizePhone(props.alternatePhone);
    const email = normalize(props.email);
    const name = normalize(props.name);

    if (phone) {
      if (!phoneIndex.has(phone)) phoneIndex.set(phone, new Set());
      phoneIndex.get(phone).add(i);
    }
    if (altPhone) {
      if (!phoneIndex.has(altPhone)) phoneIndex.set(altPhone, new Set());
      phoneIndex.get(altPhone).add(i);
    }
    if (Array.isArray(props.phones)) {
      for (const p of props.phones) {
        const normalized = normalizePhone(p);
        if (normalized) {
          if (!phoneIndex.has(normalized)) phoneIndex.set(normalized, new Set());
          phoneIndex.get(normalized).add(i);
        }
      }
    }
    if (email) {
      if (!emailIndex.has(email)) emailIndex.set(email, new Set());
      emailIndex.get(email).add(i);
    }
    if (name) {
      if (!nameIndex.has(name)) nameIndex.set(name, new Set());
      nameIndex.get(name).add(i);
    }
  }

  // Use Union-Find to group persons that share any key
  const parent = Array.from({ length: persons.length }, (_, i) => i);

  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (const indices of phoneIndex.values()) {
    const arr = [...indices];
    for (let i = 1; i < arr.length; i++) {
      union(arr[0], arr[i]);
    }
  }
  for (const indices of emailIndex.values()) {
    const arr = [...indices];
    for (let i = 1; i < arr.length; i++) {
      union(arr[0], arr[i]);
    }
  }
  // Only union by name if the group also shares phone or email
  // (name alone is too risky — "John Smith" etc.)
  for (const indices of nameIndex.values()) {
    const arr = [...indices];
    // Check if any pair in this name group already shares a phone/email group
    for (let i = 1; i < arr.length; i++) {
      if (find(arr[0]) === find(arr[i])) continue;

      const propsA = persons[arr[0]].properties || {};
      const propsB = persons[arr[i]].properties || {};

      // Only merge by name if they also share phone or email
      const phoneA = normalizePhone(propsA.phone);
      const phoneB = normalizePhone(propsB.phone);
      const emailA = normalize(propsA.email);
      const emailB = normalize(propsB.email);

      const sharesPhone =
        phoneA && phoneB && phoneA === phoneB;
      const sharesEmail =
        emailA && emailB && emailA === emailB;

      if (sharesPhone || sharesEmail) {
        union(arr[0], arr[i]);
      }
    }
  }

  // Collect groups
  const groups = new Map();
  for (let i = 0; i < persons.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }

  // Only return groups with actual duplicates
  const dupeGroups = [];
  for (const indices of groups.values()) {
    if (indices.length > 1) {
      dupeGroups.push(indices);
    }
  }

  return dupeGroups;
}

/**
 * Send a $merge_dangerously event to PostHog
 */
async function mergePersons(primaryDistinctId, aliasDistinctId) {
  const resp = await fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: POSTHOG_TOKEN,
      event: "$merge_dangerously",
      distinct_id: primaryDistinctId,
      properties: {
        alias: aliasDistinctId,
      },
    }),
  });

  if (!resp.ok) {
    console.error(
      `  ERROR merging ${aliasDistinctId} → ${primaryDistinctId}: ${resp.status}`,
    );
  }
}

/**
 * Collect all phones from a group of persons, normalize and dedupe,
 * then write the consolidated phones array to the primary person.
 */
async function consolidateGroupPhones(primaryId, groupPersons) {
  const seen = new Set();
  const merged = [];

  for (const person of groupPersons) {
    const props = person.properties || {};
    const allRaw = [];
    if (props.phone) allRaw.push(props.phone);
    if (props.alternatePhone) allRaw.push(props.alternatePhone);
    if (Array.isArray(props.phones)) allRaw.push(...props.phones);

    for (const phone of allRaw) {
      const normalized = normalizePhoneNumber(phone);
      if (!normalized) continue;
      const digits = normalized.replace(/\D/g, "");
      if (!seen.has(digits)) {
        seen.add(digits);
        merged.push(normalized);
      }
    }
  }

  if (merged.length === 0) return;

  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_TOKEN,
        event: "$identify",
        distinct_id: primaryId,
        properties: {},
        $set: { phones: merged },
      }),
    });
  } catch {
    // best-effort
  }
}

/**
 * Prompt the user with a question and return their answer
 */
function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Colorize a cell value: green if it matches the primary's value (normalized), red if not.
 * Empty values are dimmed.
 */
function colorCell(value, primaryValue, field) {
  if (!value && !primaryValue) return `${DIM}—${RESET}`;
  if (!value) return `${RED}(empty)${RESET}`;
  if (!primaryValue) return `${RED}${value}${RESET}`;

  const normFn = field === "name" ? normalizeNameForComparison
    : (field === "phone" || field === "alternatePhone" || field === "phones") ? normalizePhone
    : normalizeForComparison;

  if (normFn(value) === normFn(primaryValue)) return `${GREEN}${value}${RESET}`;
  return `${RED}${value}${RESET}`;
}

/**
 * Print a colored table for a group of persons.
 * The primary row is shown in bold; duplicate rows have fields colored
 * green (matches primary) or red (differs).
 */
function printGroupTable(groupPersons, resolvedAddresses) {
  const primary = groupPersons[0];
  const primaryProps = {
    name: primary.properties?.name || "",
    email: primary.properties?.email || "",
    address: primary.properties?.address || "",
    phone: primary.properties?.phone || "",
    alternatePhone: primary.properties?.alternatePhone || "",
    phones: Array.isArray(primary.properties?.phones) ? primary.properties.phones.join(", ") : "",
  };

  const fields = ["name", "id", "email", "address", "phone", "alternatePhone", "phones"];

  // Calculate column widths (need to strip ANSI for width calculation)
  const headers = ["", ...fields];
  const rows = groupPersons.map((p, i) => {
    const props = {
      name: p.properties?.name || "",
      id: p.distinct_ids[0],
      email: p.properties?.email || "",
      address: p.properties?.address || "",
      phone: p.properties?.phone || "",
      alternatePhone: p.properties?.alternatePhone || "",
      phones: Array.isArray(p.properties?.phones) ? p.properties.phones.join(", ") : "",
    };

    if (i === 0) {
      return {
        label: `${BOLD}PRIMARY${RESET}`,
        cells: fields.map((f) =>
          props[f] ? `${BOLD}${props[f]}${RESET}` : `${DIM}—${RESET}`,
        ),
        raw: fields.map((f) => props[f]),
      };
    }

    return {
      label: `${DIM}merge${RESET}`,
      cells: fields.map((f) =>
        f === "id"
          ? (props[f] || `${DIM}—${RESET}`)
          : colorCell(props[f], primaryProps[f], f),
      ),
      raw: fields.map((f) => props[f]),
    };
  });

  // Compute column widths from raw (uncolored) values
  const colWidths = headers.map((h, col) => {
    let max = h.length;
    for (const row of rows) {
      const rawVal = col === 0 ? "PRIMARY" : (row.raw[col - 1] || "(empty)");
      if (rawVal.length > max) max = rawVal.length;
    }
    return Math.min(max, 50); // cap at 50 chars
  });

  // Print header
  const headerLine = headers
    .map((h, i) => h.padEnd(colWidths[i]))
    .join("  ");
  console.log(`  ${DIM}${headerLine}${RESET}`);
  console.log(`  ${DIM}${"—".repeat(headerLine.length)}${RESET}`);

  // Print rows
  for (const row of rows) {
    const label = row.label.padEnd(colWidths[0] + (row.label.length - (row.label.includes("PRIMARY") ? 7 : 5)));
    const cells = row.cells.map((cell, i) => {
      const rawLen = (row.raw[i] || "(empty)").length;
      const padLen = Math.max(0, colWidths[i + 1] - Math.min(rawLen, colWidths[i + 1]));
      const truncated = row.raw[i].length > colWidths[i + 1]
        ? cell.slice(0, cell.length - (row.raw[i].length - colWidths[i + 1])) + "…"
        : cell;
      return truncated + " ".repeat(padLen);
    });
    console.log(`  ${label}  ${cells.join("  ")}`);
  }

  // Show Google Maps resolved address if available
  if (resolvedAddresses) {
    const seen = new Set();
    for (const p of groupPersons) {
      const addr = p.properties?.address || "";
      if (addr && !seen.has(addr)) {
        seen.add(addr);
        const resolved = resolvedAddresses.get(addr);
        if (resolved) {
          console.log(`  ${GREEN}Google Maps: ${resolved}${RESET}`);
        }
      }
    }
  }
}

// --- Main ---

async function main() {
  console.log("Fetching all persons from PostHog...\n");
  const persons = await fetchAllPersons();

  console.log("Finding duplicate groups...\n");
  const dupeGroups = findDuplicateGroups(persons);

  let totalDupes = 0;
  for (const group of dupeGroups) {
    totalDupes += group.length - 1;
  }

  console.log(
    `Found ${dupeGroups.length} groups with duplicates (${totalDupes} persons to merge)\n`,
  );

  let mergeCount = 0;
  let skipCount = 0;
  let autoCount = 0;

  for (let g = 0; g < dupeGroups.length; g++) {
    const group = dupeGroups[g];
    const groupPersons = group.map((i) => persons[i]);

    // Pick the person with the most properties as primary,
    // but prefer persons that have a Jobber ID (starts with "Z2lk")
    groupPersons.sort((a, b) => {
      const aHasJobber = (a.distinct_ids || []).some((id) => id.startsWith("Z2lk"));
      const bHasJobber = (b.distinct_ids || []).some((id) => id.startsWith("Z2lk"));
      if (aHasJobber && !bHasJobber) return -1;
      if (!aHasJobber && bHasJobber) return 1;
      return propertyCount(b) - propertyCount(a);
    });

    const primary = groupPersons[0];
    // Use the Jobber ID as primaryId if available, otherwise first distinct_id
    const primaryId =
      (primary.distinct_ids || []).find((id) => id.startsWith("Z2lk")) ||
      primary.distinct_ids[0];
    const primaryName =
      primary.properties?.name || primary.properties?.phone || primaryId;

    // Resolve addresses via Google Maps for the group (best-effort)
    const resolvedAddresses = new Map();
    for (const p of groupPersons) {
      const addr = p.properties?.address || "";
      if (addr && !resolvedAddresses.has(addr)) {
        resolvedAddresses.set(addr, await resolveAddress(addr));
      }
    }

    // Check if all non-empty fields match across the group (using normalized comparison)
    const allMatch = groupPersons.every((p) => {
      for (const key of ["name", "email", "address", "phone"]) {
        const pVal = p.properties?.[key] || "";
        const primaryVal = primary.properties?.[key] || "";
        // Both empty is fine; if either has a value, they must match (normalized)
        if (!pVal || !primaryVal) continue;

        if (key === "address") {
          // Try Google Maps comparison first
          const resolvedP = resolvedAddresses.get(pVal);
          const resolvedPrimary = resolvedAddresses.get(primaryVal);
          if (resolvedP && resolvedPrimary) {
            if (resolvedP !== resolvedPrimary) return false;
          } else {
            // Fall back to normalizeForComparison if geocoding failed
            if (normalizeForComparison(pVal) !== normalizeForComparison(primaryVal)) return false;
          }
          continue;
        }

        const normFn = key === "name" ? normalizeNameForComparison
          : key === "phone" ? normalizePhone
          : normalizeForComparison;
        if (normFn(pVal) !== normFn(primaryVal)) return false;
      }
      // Compare phones arrays (normalized)
      const pPhones = Array.isArray(p.properties?.phones) ? p.properties.phones : [];
      const primaryPhones = Array.isArray(primary.properties?.phones) ? primary.properties.phones : [];
      if (pPhones.length > 0 && primaryPhones.length > 0) {
        const normP = pPhones.map(normalizePhone).filter(Boolean).sort().join(",");
        const normPrimary = primaryPhones.map(normalizePhone).filter(Boolean).sort().join(",");
        if (normP !== normPrimary) return false;
      }
      return true;
    });

    if (!DRY_RUN && allMatch) {
      autoCount++;
      process.stdout.write(
        `\r  Auto-merging exact matches... ${autoCount} groups (${mergeCount} merges)`,
      );

      for (let i = 1; i < groupPersons.length; i++) {
        const dupeId = groupPersons[i].distinct_ids[0];
        await mergePersons(primaryId, dupeId);
        mergeCount++;

        if (mergeCount % 50 === 0) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Consolidate and normalize phones from all merged persons
      await consolidateGroupPhones(primaryId, groupPersons);

      // Update primary address to Google Maps formatted version if it differs
      const primaryAddr = primary.properties?.address || "";
      const resolvedPrimaryAddr = resolvedAddresses.get(primaryAddr);
      if (resolvedPrimaryAddr && resolvedPrimaryAddr !== primaryAddr) {
        try {
          await fetch(`${POSTHOG_HOST}/capture/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: POSTHOG_TOKEN,
              event: "$identify",
              distinct_id: primaryId,
              properties: {},
              $set: { address: resolvedPrimaryAddr },
            }),
          });
        } catch {
          // best-effort — ignore failures
        }
      }

      continue;
    }

    if (autoCount > 0) {
      // Clear the auto-merge progress line before printing a table
      process.stdout.write("\n");
      autoCount = 0;
    }

    console.log(
      `\n[${g + 1}/${dupeGroups.length}] "${primaryName}" — ${groupPersons.length} persons`,
    );

    printGroupTable(groupPersons, resolvedAddresses);

    if (!DRY_RUN) {
      const answer = await ask("\n  Merge these? (Y/n): ");
      if (answer.toLowerCase() === "n") {
        console.log("  Skipped.");
        skipCount++;
        continue;
      }

      for (let i = 1; i < groupPersons.length; i++) {
        const dupeId = groupPersons[i].distinct_ids[0];
        await mergePersons(primaryId, dupeId);
        mergeCount++;

        // Rate limit
        if (mergeCount % 50 === 0) {
          console.log(`  ... pausing (${mergeCount} merges so far)`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Consolidate and normalize phones from all merged persons
      await consolidateGroupPhones(primaryId, groupPersons);

      // Update primary address to Google Maps formatted version if it differs
      const manualPrimaryAddr = primary.properties?.address || "";
      const manualResolvedAddr = resolvedAddresses.get(manualPrimaryAddr);
      if (manualResolvedAddr && manualResolvedAddr !== manualPrimaryAddr) {
        try {
          await fetch(`${POSTHOG_HOST}/capture/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: POSTHOG_TOKEN,
              event: "$identify",
              distinct_id: primaryId,
              properties: {},
              $set: { address: manualResolvedAddr },
            }),
          });
          console.log(`  Updated address to: ${manualResolvedAddr}`);
        } catch {
          // best-effort — ignore failures
        }
      }

      console.log(`  Merged ${groupPersons.length - 1} person(s) into ${primaryId}`);
    }
  }

  if (DRY_RUN) {
    console.log(`\nDry run complete. ${totalDupes} merges would be performed.`);
  } else {
    console.log(
      `\nDone. ${mergeCount} merges performed, ${skipCount} groups skipped.`,
    );
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
