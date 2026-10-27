import * as Sentry from "@sentry/node";
import events from "../events.js";
import prisma from "../prismaClient.js";
import { toE164 } from "../DataUtilities.js";
import { isUniqueConstraintOn } from "../prismaErrors.js";
import * as PostHog from "./PostHog.js";
import {
  searchCallByPhone,
  searchSMSByPhone,
  updateCall,
  updateSMSThread,
} from "./CallRail.js";
import { findFormLead, sendFormValue } from "./GoogleAdsLeadFormValues.js";

/**
 * Credits paid work to the contact that brought it in, so CallRail and Google
 * Ads see what each lead was worth.
 *
 * A fully paid invoice, or a deposit, is credited to the client's earliest
 * contact (a CallRail call or a form lead) from the 30 days before the work
 * started, where the work started when its quote or job was created. An SMS
 * thread is credited only when there's neither, since threads have no start
 * time or click ID. Work with no contact in that window (a returning client's
 * scheduled job) isn't credited, so a client's history never counts toward a
 * new ad click. Clients with an excluded tag (contract accounts like Ingles)
 * are never credited.
 *
 * Each credited item gets an AdValueAttribution row, and a contact's value is
 * the sum of its rows. So a diagnostic and the repair that follows add up, the
 * same item is never counted twice, and a deposit's row is replaced by the
 * invoice it's applied to. The sum is written to the CallRail call or thread
 * (whose call-modified webhook restates Google Ads) or sent for the form lead.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long before the work started a contact still gets the credit */
export const ATTRIBUTION_WINDOW_MS = 30 * DAY_MS;

/** A contact this soon after the work started still counts (a quote made during the call) */
export const START_GRACE_MS = 60 * 60 * 1000;

/** Google Ads only takes adjustments this long after the conversion */
export const ADJUSTMENT_WINDOW_MS = 55 * DAY_MS;

/**
 * @returns {string[]} Client tags whose clients are never credited
 */
export function excludedTags() {
  return (process.env.AD_VALUE_EXCLUDED_CLIENT_TAGS ?? "Billout")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * @param {object} client - A Jobber client (tags.nodes[].label) or database row (tags[])
 * @returns {boolean} Whether the client has an excluded tag
 */
export function isExcludedClient(client) {
  const tags = Array.isArray(client?.tags)
    ? client.tags
    : (client?.tags?.nodes ?? []).map((tag) => tag.label);
  const excluded = excludedTags();
  return tags.some((tag) => excluded.includes(tag));
}

/**
 * Whether a phone number belongs to a client with an excluded tag. Never
 * throws; a failed lookup counts as not excluded.
 * @param {string} phone
 * @returns {Promise<boolean>}
 */
export async function isExcludedPhone(phone) {
  const e164 = toE164(phone);
  if (!e164) {
    return false;
  }
  try {
    const clients = await prisma.client.findMany({
      where: { tags: { hasSome: excludedTags() } },
      select: { phones: true },
    });
    return clients.some((client) =>
      (Array.isArray(client.phones) ? client.phones : []).some(
        (p) => toE164(p?.number) === e164,
      ),
    );
  } catch (e) {
    Sentry.captureException(e);
    console.error("AdValue: Excluded phone lookup failed:", e);
    return false;
  }
}

/**
 * Collects the client's phone numbers from Jobber and PostHog (PostHog has
 * the calling number when it differs from the Jobber callback number).
 * @param {object} client - The Jobber client
 * @returns {Promise<string[]>} E.164 numbers
 */
async function clientPhones(client) {
  const phones = new Set();
  for (const entry of client.phones ?? []) {
    const e164 = toE164(entry.number);
    if (e164) phones.add(e164);
  }

  try {
    const result = await PostHog.individualSearch(client.id, "distinct_id");
    const props = result?.results?.[0]?.properties ?? {};
    for (const p of [
      props.phone,
      props.alternatePhone,
      ...(Array.isArray(props.phones) ? props.phones : []),
    ]) {
      const e164 = toE164(p);
      if (e164) phones.add(e164);
    }
  } catch (e) {
    // PostHog lookup is best-effort; don't block on failure
    console.warn("AdValue: PostHog phone lookup failed:", e.message);
  }

  return [...phones];
}

/**
 * @param {object} record - A CallRail call or SMS thread
 * @returns {boolean} Whether this app set its value (old values were tagged)
 */
function valuedByUs(record) {
  return (record.tags ?? []).some(
    (tag) => (tag?.name ?? tag) === "invoice-paid",
  );
}

/**
 * Finds the contact that brought in work started at `workStartedAt`.
 * @param {object} client - The Jobber client
 * @param {Date} workStartedAt
 * @returns {Promise<object|null>} {kind, id, at, record}
 */
async function findContact(client, workStartedAt) {
  const from = new Date(workStartedAt.getTime() - ATTRIBUTION_WINDOW_MS);
  const until = new Date(workStartedAt.getTime() + START_GRACE_MS);
  const inWindow = (at) => !isNaN(at) && at >= from && at <= until;
  const phones = await clientPhones(client);

  const candidates = [];
  const seen = new Set();
  for (const phone of phones) {
    for (const call of await searchCallByPhone(phone)) {
      const at = new Date(call.start_time);
      // Our own calls back to the client aren't how they reached us
      if (seen.has(call.id) || call.direction === "outbound" || !inWindow(at)) {
        continue;
      }
      seen.add(call.id);
      candidates.push({ kind: "call", id: call.id, at, record: call });
    }
  }

  const lead = await findFormLead(client, { from, until });
  if (lead) {
    candidates.push({
      kind: "form",
      id: lead.leadId,
      at: new Date(lead.createdAt),
      record: lead,
    });
  }

  if (candidates.length > 0) {
    return candidates.sort((a, b) => a.at - b.at)[0];
  }

  // A thread only has its last message time, so take the most recent one
  // that was active in the window
  let thread = null;
  for (const phone of phones) {
    for (const candidate of await searchSMSByPhone(phone)) {
      const at = new Date(candidate.last_message_at);
      if (at >= from && (!thread || at > thread.at)) {
        thread = { kind: "sms", id: candidate.id, at, record: candidate };
      }
    }
  }
  return thread;
}

/**
 * Writes a contact's total to CallRail, or sends it for a form lead.
 * @param {object} contact - {kind, id, record?}
 * @param {number} total
 * @param {object} client - The Jobber client
 * @param {string} note
 */
async function writeTotal(contact, total, client, note) {
  if (contact.kind === "call") {
    await updateCall(contact.id, {
      value: total,
      note,
      customer_name: client.name,
      lead_status:
        contact.record?.lead_status === "previously_marked_good_lead"
          ? null
          : "good_lead",
    });
  } else if (contact.kind === "sms") {
    await updateSMSThread(contact.id, {
      value: total,
      notes: note,
      lead_qualification:
        contact.record?.lead_qualification === "good_lead" ? null : "good_lead",
    });
  } else if (contact.kind === "form") {
    const lead =
      contact.record ??
      (await prisma.googleAdsLeadFormLead.findUnique({
        where: { leadId: contact.id },
      }));
    if (lead) {
      await sendFormValue(lead, total);
    }
  }
  console.log(
    `AdValue: ${contact.kind} ${contact.id} now carries $${total} for ${client.name}`,
  );
}

/**
 * @param {string} contactId
 * @returns {Promise<number>} The sum of the contact's rows, to the cent
 */
async function contactTotal(contactId) {
  const rows = await prisma.adValueAttribution.findMany({
    where: { contactId },
  });
  return (
    Math.round(rows.reduce((sum, row) => sum + Number(row.value), 0) * 100) /
    100
  );
}

/**
 * Credits one paid item to the contact that brought it in.
 * @param {object} client - The Jobber client (phones, tags, name, jobberWebUri)
 * @param {object} item
 * @param {"invoice"|"deposit"} item.kind
 * @param {string} item.id - Jobber invoice id or deposit payment id
 * @param {number} item.value
 * @param {Date} item.workStartedAt
 * @param {string|null} [item.quoteId] - A deposit's quote
 * @param {string[]} [item.quoteIds] - An invoice's quotes, whose deposits it replaces
 * @param {string} [item.note] - CallRail note line for the item
 */
async function creditItem(client, item) {
  if (isExcludedClient(client)) {
    console.log(
      `AdValue: ${client.name} has an excluded tag, not crediting ${item.kind} ${item.id}`,
    );
    return;
  }

  if (
    await prisma.adValueAttribution.findUnique({ where: { itemId: item.id } })
  ) {
    return;
  }

  const contact = await findContact(client, item.workStartedAt);
  if (!contact) {
    console.log(
      `AdValue: No contact in the 30 days before ${item.kind} ${item.id} (work started ${item.workStartedAt.toISOString()}) for ${client.name}, not crediting`,
    );
    return;
  }

  // A value we have no rows for was set by hand, or by this app before rows
  // were kept (tagged invoice-paid). That one becomes the starting value,
  // unless its note shows it's this same item.
  const existing = Number(contact.record?.value ?? 0);
  if (contact.kind !== "form" && existing > 0) {
    const rows = await prisma.adValueAttribution.count({
      where: { contactId: contact.id },
    });
    const existingNote = contact.record.note ?? contact.record.notes ?? "";
    if (rows === 0 && !valuedByUs(contact.record)) {
      console.log(
        `AdValue: ${contact.kind} ${contact.id} already has a value of $${existing} set by hand, not crediting ${item.kind} ${item.id}`,
      );
      return;
    }
    if (rows === 0 && !(item.note && existingNote.includes(item.note))) {
      await prisma.adValueAttribution.upsert({
        where: { itemId: `legacy-${contact.id}` },
        update: {},
        create: {
          itemId: `legacy-${contact.id}`,
          itemKind: "legacy",
          clientId: client.id,
          contactKind: contact.kind,
          contactId: contact.id,
          value: existing,
        },
      });
    }
  }

  try {
    await prisma.adValueAttribution.create({
      data: {
        itemId: item.id,
        itemKind: item.kind,
        quoteId: item.quoteId ?? null,
        clientId: client.id,
        contactKind: contact.kind,
        contactId: contact.id,
        value: item.value,
        workStartedAt: item.workStartedAt,
      },
    });
  } catch (e) {
    if (isUniqueConstraintOn(e, "itemId", "AdValueAttribution_pkey")) {
      console.log(`AdValue: ${item.kind} ${item.id} was credited concurrently`);
      return;
    }
    throw e;
  }

  // The deposits this invoice includes stop counting on their own
  const replaced = item.quoteIds?.length
    ? await prisma.adValueAttribution.findMany({
        where: { itemKind: "deposit", quoteId: { in: item.quoteIds } },
      })
    : [];
  const replacedHere = replaced
    .filter((row) => row.contactId === contact.id)
    .reduce((sum, row) => sum + Number(row.value), 0);

  const total =
    Math.round(((await contactTotal(contact.id)) - replacedHere) * 100) / 100;
  const note = `Client: ${client.jobberWebUri}\n${item.note ?? ""}`.trim();
  try {
    await writeTotal(contact, total, client, note);
  } catch (e) {
    // Leave it uncredited so a later trigger tries again
    await prisma.adValueAttribution.deleteMany({ where: { itemId: item.id } });
    throw e;
  }

  if (replaced.length > 0) {
    await prisma.adValueAttribution.deleteMany({
      where: { itemId: { in: replaced.map((row) => row.itemId) } },
    });
    // A deposit credited to a different contact loses its value there
    const others = new Map(
      replaced
        .filter((row) => row.contactId !== contact.id)
        .map((row) => [row.contactId, row]),
    );
    for (const row of others.values()) {
      await writeTotal(
        { kind: row.contactKind, id: row.contactId },
        await contactTotal(row.contactId),
        client,
        `Client: ${client.jobberWebUri}`,
      );
    }
  }
}

/**
 * When an invoice's work started: the earliest creation of its jobs and their
 * quotes, or the invoice's own creation when none are stored.
 * @param {string[]} jobIds
 * @param {Date} fallback
 * @returns {Promise<{workStartedAt: Date, quoteIds: string[]}>}
 */
async function invoiceWorkStart(jobIds, fallback) {
  const jobs = jobIds.length
    ? await prisma.job.findMany({
        where: { id: { in: jobIds } },
        select: {
          createdAt: true,
          quoteId: true,
          quotes: { select: { quoteId: true } },
        },
      })
    : [];
  const quoteIds = [
    ...new Set(
      jobs.flatMap((job) => [
        ...(job.quoteId ? [job.quoteId] : []),
        ...job.quotes.map((link) => link.quoteId),
      ]),
    ),
  ];
  const quotes = quoteIds.length
    ? await prisma.quote.findMany({
        where: { id: { in: quoteIds } },
        select: { createdAt: true },
      })
    : [];
  const times = [...jobs, ...quotes].map((row) => new Date(row.createdAt));
  if (times.length === 0) {
    times.push(new Date(fallback));
  }
  return {
    workStartedAt: new Date(Math.min(...times.map((t) => t.getTime()))),
    quoteIds,
  };
}

/**
 * Credits a fully paid invoice.
 * @param {object} client - The Jobber client
 * @param {object} invoice - {id, total, createdAt, jobberWebUri, jobIds}
 */
export async function creditInvoice(client, invoice) {
  const { workStartedAt, quoteIds } = await invoiceWorkStart(
    invoice.jobIds,
    invoice.createdAt,
  );
  await creditItem(client, {
    kind: "invoice",
    id: invoice.id,
    value: Number(invoice.total),
    workStartedAt,
    quoteIds,
    note: `Invoice: ${invoice.jobberWebUri}`,
  });
}

/**
 * Credits a deposit, unless it's already part of a paid invoice (which gets
 * the credit instead).
 * @param {object} client - The Jobber client
 * @param {object} deposit - {id, amount, entryDate, quoteId, invoiceId}
 */
export async function creditDeposit(client, deposit) {
  if (deposit.invoiceId) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: deposit.invoiceId },
      select: { invoiceStatus: true },
    });
    if (invoice?.invoiceStatus === "paid") {
      return;
    }
  }

  const quote = deposit.quoteId
    ? await prisma.quote.findUnique({
        where: { id: deposit.quoteId },
        select: { createdAt: true, jobberWebUri: true },
      })
    : null;
  await creditItem(client, {
    kind: "deposit",
    id: deposit.id,
    value: Number(deposit.amount),
    workStartedAt: new Date(quote?.createdAt ?? deposit.entryDate),
    quoteId: deposit.quoteId ?? null,
    note: quote ? `Quote: ${quote.jobberWebUri}` : "Deposit",
  });
}

/**
 * Credits the client's paid invoices and deposits from the last `days` days
 * that haven't been credited yet. Runs when a client changes (a phone number
 * added after they paid can now match their call).
 * @param {object} client - The Jobber client
 * @param {object} [options]
 * @param {Date} [options.since] - Oldest payment to consider (default: 55 days ago)
 */
export async function creditRecentItems(
  client,
  { since = new Date(Date.now() - ADJUSTMENT_WINDOW_MS) } = {},
) {
  if (isExcludedClient(client)) {
    return;
  }

  const deposits = await prisma.payment.findMany({
    where: {
      client: client.id,
      adjustmentType: "DEPOSIT",
      entryDate: { gte: since },
    },
  });
  const invoices = await prisma.invoice.findMany({
    where: {
      clientId: client.id,
      invoiceStatus: "paid",
      receivedDate: { gte: since },
    },
  });
  if (deposits.length === 0 && invoices.length === 0) {
    return;
  }

  const credited = new Set(
    (
      await prisma.adValueAttribution.findMany({
        where: {
          itemId: { in: [...deposits, ...invoices].map((item) => item.id) },
        },
        select: { itemId: true },
      })
    ).map((row) => row.itemId),
  );

  // Deposits first, so a paid invoice then replaces them
  for (const deposit of deposits) {
    if (credited.has(deposit.id)) continue;
    await creditDeposit(client, {
      id: deposit.id,
      amount: deposit.amount,
      entryDate: deposit.entryDate,
      quoteId: deposit.quote,
      invoiceId: deposit.invoice,
    });
  }
  for (const invoice of invoices) {
    if (credited.has(invoice.id)) continue;
    const links = await prisma.jobsOnInvoices.findMany({
      where: { invoiceId: invoice.id },
      select: { jobId: true },
    });
    await creditInvoice(client, {
      id: invoice.id,
      total: invoice.total,
      createdAt: invoice.createdAt,
      jobberWebUri: invoice.jobberWebUri,
      jobIds: links.map((link) => link.jobId),
    });
  }
}

/**
 * Runs a credit without letting its error reach the webhook handler.
 * @param {string} label
 * @param {() => Promise<void>} fn
 */
async function safely(label, fn) {
  try {
    await fn();
  } catch (e) {
    Sentry.captureException(e);
    console.error(`AdValue: Error crediting ${label}:`, e);
  }
}

events.on("ad-value-INVOICE", (invoice) =>
  safely(`invoice ${invoice.id}`, () =>
    creditInvoice(invoice.client, {
      id: invoice.id,
      total: invoice.amounts.total,
      createdAt: invoice.createdAt,
      jobberWebUri: invoice.jobberWebUri,
      jobIds: (invoice.jobs?.nodes ?? []).map((job) => job.id),
    }),
  ),
);

events.on("ad-value-DEPOSIT", (payment) =>
  safely(`deposit ${payment.id}`, () =>
    creditDeposit(payment.client, {
      id: payment.id,
      amount: payment.amount,
      entryDate: payment.entryDate,
      quoteId: payment.quote?.id ?? null,
      invoiceId: payment.invoice?.id ?? null,
    }),
  ),
);

events.on("ad-value-CLIENT", (client) =>
  safely(`client ${client.id}`, () => creditRecentItems(client)),
);
