import events from "../events.js";
import * as Sentry from "@sentry/node";

import prisma from "../prismaClient.js";
import {
  getUserData,
  getPropertyData,
  getJobData,
  getInvoiceData,
  getClientData,
  getQuoteData,
  getPaymentData,
  getVisitData,
  getRequestData,
  getTimesheetData,
} from "./Jobber.js";
import {
  uniqueConstraintFields,
  isUniqueConstraintOn,
} from "../prismaErrors.js";

export { uniqueConstraintFields, isUniqueConstraintOn };

/** Jobber sends no user webhooks, so a stored user is refreshed when it's this old */
export const USER_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Parses an optional Jobber timestamp. `new Date(null)` is the epoch, so a
 * missing value (e.g. endAt on a running timer) must stay null instead.
 * @param {string|null|undefined} value
 * @returns {Date|null}
 */
function optionalDate(value) {
  return value ? new Date(value) : null;
}

/**
 * Flattens Jobber custom fields (any of the six types) to label/type/value.
 * @param {Array<object>|undefined} fields
 * @returns {Array<object>|undefined} undefined leaves the column unchanged
 */
export function customFieldsJson(fields) {
  if (!Array.isArray(fields)) return undefined;
  return fields.map((field) => ({
    label: field.label ?? null,
    type: field.__typename ?? null,
    value:
      field.valueText ??
      field.valueNumeric ??
      field.valueTrueFalse ??
      field.valueDropdown ??
      field.valueLink ??
      field.valueArea ??
      null,
    ...(field.unit ? { unit: field.unit } : {}),
  }));
}

/**
 * Replaces a quote's, job's or invoice's stored line items with Jobber's.
 * @param {"quote"|"job"|"invoice"} kind
 * @param {string} parentId
 * @param {{nodes: Array<object>}|undefined} lineItems
 */
async function replaceLineItems(kind, parentId, lineItems) {
  if (!Array.isArray(lineItems?.nodes)) return;
  const parentKey = `${kind}Id`;
  const rows = lineItems.nodes.map((item) => ({
    id: item.id,
    kind,
    [parentKey]: parentId,
    productOrServiceId: item.linkedProductOrService?.id ?? null,
    jobLineItemId: item.jobLineItem?.id ?? null,
    name: item.name ?? null,
    description: item.description ?? null,
    category: item.category ?? null,
    quantity: item.quantity ?? null,
    unitPrice: item.unitPrice ?? null,
    unitCost: item.unitCost ?? null,
    totalPrice: item.totalPrice ?? null,
    totalCost: item.totalCost ?? null,
    originalCost: item.originalCost ?? null,
    markup: item.markup ?? null,
    taxable: item.taxable ?? null,
    optional: item.optional ?? null,
    recommended: item.recommended ?? null,
    textOnly: item.textOnly ?? null,
    sortOrder: item.sortOrder ?? null,
    date: optionalDate(item.date),
    createdAt: optionalDate(item.createdAt),
    updatedAt: optionalDate(item.updatedAt),
  }));
  await prisma.$transaction([
    prisma.lineItem.deleteMany({ where: { [parentKey]: parentId } }),
    prisma.lineItem.createMany({ data: rows, skipDuplicates: true }),
  ]);
}

async function userUpsert(data) {
  const row = {
    createdAt: new Date(data.createdAt),
    email: data.email.raw,
    id: data.id,
    isAccountAdmin: data.isAccountAdmin,
    isAccountOwner: data.isAccountOwner,
    name: data.name.full,
    phone: data.phone.friendly,
    status: data.status,
    firstName: data.name.first ?? null,
    lastName: data.name.last ?? null,
    assignedColor: data.assignedColor ?? null,
    lastLoginAt: optionalDate(data.lastLoginAt),
    timezone: data.timezone ?? null,
    uuid: data.uuid ?? null,
    addressStreet: data.address?.street || null,
    addressCity: data.address?.city || null,
    addressProvince: data.address?.province || null,
    addressPostalCode: data.address?.postalCode || null,
    addressCountry: data.address?.country || null,
    customFields: customFieldsJson(data.customFields),
    syncedAt: new Date(),
  };
  // Separate the data for update and create operations
  // The update operation should not include the id field as it's already in the where clause
  const { id, ...updateData } = row;

  await prisma.user.upsert({
    where: { id: data.id },
    update: { ...updateData },
    create: { ...row },
  });
  console.log("Postgres: Upserted user");
}

/**
 * Saves a user that isn't stored yet, and refreshes one last synced more than
 * USER_REFRESH_MS ago (Jobber sends no webhooks for user changes).
 * @param {string|null} id
 */
async function ensureUserExists(id) {
  if (!id) return;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { syncedAt: true },
  });
  if (
    user?.syncedAt &&
    Date.now() - new Date(user.syncedAt).getTime() < USER_REFRESH_MS
  ) {
    return;
  }

  const apiResponse = await getUserData(id);
  if (apiResponse) {
    await userUpsert(apiResponse);
  }
}

async function propertyUpsert(data) {
  const row = {
    city: data.address.city,
    country: data.address.country,
    id: data.id,
    latitude: data.address.coordinates
      ? data.address.coordinates.latitude
      : null,
    longitude: data.address.coordinates
      ? data.address.coordinates.longitude
      : null,
    postalCode: data.address.postalCode,
    province: data.address.province,
    street: data.address.street,
    isBillingAddress: data.isBillingAddress,
    jobberWebUri: data.jobberWebUri,
    client: data.client.id,
    name: data.name ?? null,
    street1: data.address.street1 ?? null,
    street2: data.address.street2 || null,
    routingOrder: data.routingOrder ?? null,
    createdAt: optionalDate(data.createdAt),
    customFields: customFieldsJson(data.customFields),
  };
  // Separate the data for update and create operations
  // The update operation should not include the id field as it's already in the where clause
  const { id, ...updateData } = row;

  await prisma.property.upsert({
    where: { id: data.id },
    update: { ...updateData },
    create: { ...row },
  });
  console.log("Postgres: Upserted property");
}

async function ensurePropertyExists(id) {
  const property = await prisma.property.findMany({
    where: { id: { equals: id } },
  });

  // Query the API for the property and insert it
  if (property.length === 0) {
    // Create the property
    const apiResponse = await getPropertyData(id);
    await propertyUpsert(apiResponse);
  }
}

async function clientCreateUpdate(data) {
  const row = {
    companyName: data.companyName,
    createdAt: new Date(data.createdAt),
    firstName: data.firstName,
    id: data.id,
    isArchivable: data.isArchivable,
    isArchived: data.isArchived,
    isCompany: data.isCompany,
    isLead: data.isLead,
    lastName: data.lastName,
    name: data.name,
    title: data.title,
    updatedAt: new Date(data.updatedAt),
    jobberWebUri: data.jobberWebUri,
    balance: data.balance,
    billingStreet: data.billingAddress?.street,
    billingStreet1: data.billingAddress?.street1,
    billingStreet2: data.billingAddress?.street2,
    billingCity: data.billingAddress?.city,
    billingProvince: data.billingAddress?.province,
    billingPostalCode: data.billingAddress?.postalCode,
    billingCountry: data.billingAddress?.country,
    leadSource: data.leadSource,
    sourceText:
      data.sourceAttribution?.sourceText ||
      data.sourceAttribution?.displayLeadSource ||
      null,
    sourceMetadata: data.sourceAttribution?.metadata ?? undefined,
    utmMedium: data.utmMedium,
    secondaryName: data.secondaryName,
    receivesFollowUps: data.receivesFollowUps,
    receivesInvoiceFollowUps: data.receivesInvoiceFollowUps,
    receivesQuoteFollowUps: data.receivesQuoteFollowUps,
    receivesReminders: data.receivesReminders,
    receivesReviewRequests: data.receivesReviewRequests,
    phones: data.phones ?? undefined,
    emails: data.emails ?? undefined,
    tags: data.tags?.nodes?.map((tag) => tag.label),
    customFields: customFieldsJson(data.customFields),
  };
  // Separate the data for update and create operations
  // The update operation should not include the id field as it's already in the where clause
  const { id, ...updateData } = row;

  await prisma.client.upsert({
    where: { id: data.id },
    update: { ...updateData },
    create: { ...row },
  });
  console.log("Postgres: Upserted client");
}
events.on("db-CLIENT_CREATE_UPDATE", clientCreateUpdate);

/**
 * Saves again the stored records Jobber still has. Jobber merges clients and
 * properties by moving their work to the one it keeps, then sends only a
 * destroy for the other one, with no updates for what moved.
 * @param {string} kind - What the records are, for the log
 * @param {string[]} ids - Stored record IDs
 * @param {(id: string) => Promise<object|null>} fetchRecord - Jobber getter
 * @param {(data: object) => Promise<void>} save - Saves the fetched record
 * @returns {Promise<void>}
 */
async function resaveFromJobber(kind, ids, fetchRecord, save) {
  let resaved = 0;
  for (const id of ids) {
    const data = await fetchRecord(id);
    if (data) {
      await save(data);
      resaved++;
    }
  }
  if (resaved > 0) {
    console.log(`Postgres: Re-saved ${resaved} ${kind} Jobber still has`);
  }
}

/** IDs of the stored rows of a model matching a filter */
async function storedIds(model, where) {
  const rows = await prisma[model].findMany({ where, select: { id: true } });
  return rows.map((row) => row.id);
}

/**
 * Removes a client and everything of theirs. Work Jobber still has (moved to
 * another client by a merge) is saved again first, so only what Jobber
 * deleted goes. Link rows and payments are deleted before the rows they point
 * at, and timesheets and expenses (which belong to employees) are kept with
 * their client and job references cleared.
 * @param {string} id - Jobber client ID
 */
async function clientDestroy(id) {
  try {
    const where = { client: id };
    const whereClientId = { clientId: id };
    await resaveFromJobber(
      "properties",
      await storedIds("property", where),
      getPropertyData,
      propertyCreateUpdate,
    );
    await resaveFromJobber(
      "quotes",
      await storedIds("quote", whereClientId),
      getQuoteData,
      quoteCreateUpdate,
    );
    await resaveFromJobber(
      "jobs",
      await storedIds("job", whereClientId),
      getJobData,
      jobCreateUpdate,
    );
    await resaveFromJobber(
      "invoices",
      await storedIds("invoice", whereClientId),
      getInvoiceData,
      invoiceCreateUpdate,
    );
    await resaveFromJobber(
      "payments",
      await storedIds("payment", where),
      getPaymentData,
      paymentCreateUpdate,
    );
    await resaveFromJobber(
      "visits",
      await storedIds("visit", whereClientId),
      getVisitData,
      visitCreateUpdate,
    );
    await resaveFromJobber(
      "requests",
      await storedIds("request", whereClientId),
      getRequestData,
      requestCreateUpdate,
    );
    await resaveFromJobber(
      "timesheets",
      await storedIds("timeSheetEntry", where),
      getTimesheetData,
      upsertTimesheet,
    );

    await prisma.$transaction(async (tx) => {
      const ids = async (model, where) =>
        (await tx[model].findMany({ where, select: { id: true } })).map(
          (row) => row.id,
        );
      const quoteIds = await ids("quote", { clientId: id });
      const jobIds = await ids("job", { clientId: id });
      const invoiceIds = await ids("invoice", { clientId: id });

      await tx.quotesOnJobs.deleteMany({
        where: {
          OR: [{ quoteId: { in: quoteIds } }, { jobId: { in: jobIds } }],
        },
      });
      await tx.jobsOnInvoices.deleteMany({
        where: {
          OR: [{ jobId: { in: jobIds } }, { invoiceId: { in: invoiceIds } }],
        },
      });
      await tx.payment.deleteMany({
        where: { OR: [{ client: id }, { invoice: { in: invoiceIds } }] },
      });
      await tx.timeSheetEntry.updateMany({
        where: { client: id },
        data: { client: null },
      });
      await tx.timeSheetEntry.updateMany({
        where: { job: { in: jobIds } },
        data: { job: null },
      });
      await tx.expense.updateMany({
        where: { linkedJob: { in: jobIds } },
        data: { linkedJob: null },
      });

      await tx.lineItem.deleteMany({
        where: {
          OR: [
            { quoteId: { in: quoteIds } },
            { jobId: { in: jobIds } },
            { invoiceId: { in: invoiceIds } },
          ],
        },
      });
      await tx.visit.deleteMany({ where: { clientId: id } });
      await tx.request.deleteMany({ where: { clientId: id } });

      await tx.quote.deleteMany({ where: { clientId: id } });
      await tx.job.deleteMany({ where: { clientId: id } });
      await tx.invoice.deleteMany({ where: { clientId: id } });
      await tx.property.deleteMany({ where: { client: id } });

      // The client may not exist if it was never synced
      const deleted = await tx.client.deleteMany({ where: { id } });
      if (deleted.count > 0) {
        console.log("Postgres: Destroyed client");
      } else {
        console.log("Postgres: Client not found in DB, nothing to delete");
      }
    });
  } catch (e) {
    Sentry.captureException(e, { extra: { clientId: id } });
    console.error(`Postgres: Error destroying client ${id}:`, e);
  }
}
events.on("db-CLIENT_DESTROY", clientDestroy);

async function invoiceCreateUpdate(data) {
  if (data.salesperson) {
    await ensureUserExists(data.salesperson ? data.salesperson.id : null);
  }
  await clientCreateUpdate(data.client);

  const row = {
    depositAmount: data.amounts.depositAmount,
    discountAmount: data.amounts.discountAmount,
    invoiceBalance: data.amounts.invoiceBalance,
    paymentsTotal: data.amounts.paymentsTotal,
    subtotal: data.amounts.subtotal,
    total: data.amounts.total,
    legacyDiscountAmount: data.amounts.legacyDiscountAmount,
    nonTaxAmount: data.amounts.nonTaxAmount,
    taxAmount: data.amounts.taxAmount,
    tipsTotal: data.amounts.tipsTotal,
    clientId: data.client.id,
    createdAt: new Date(data.createdAt),
    dueDate: optionalDate(data.dueDate),
    id: data.id,
    invoiceNet: data.invoiceNet,
    invoiceNumber: Number(data.invoiceNumber),
    invoiceStatus: data.invoiceStatus,
    issuedDate: optionalDate(data.issuedDate),
    jobberWebUri: data.jobberWebUri,
    message: data.message,
    receivedDate: optionalDate(data.receivedDate),
    salesperson: data.salesperson ? data.salesperson.id : null,
    subject: data.subject,
    updatedAt: new Date(data.updatedAt),
    billingStreet: data.billingAddress?.street,
    billingStreet1: data.billingAddress?.street1,
    billingStreet2: data.billingAddress?.street2,
    billingCity: data.billingAddress?.city,
    billingProvince: data.billingAddress?.province,
    billingPostalCode: data.billingAddress?.postalCode,
    billingCountry: data.billingAddress?.country,
    clientHubUri: data.clientHubUri,
    dateViewedInClientHub: optionalDate(data.dateViewedInClientHub),
    allowReviewRequest: data.allowReviewRequest,
    waitingForFinancedPayment: data.waitingForFinancedPayment,
    voidedAt: optionalDate(data.voidDetails?.voidedAt),
    voidReasonCode: data.voidDetails?.voidReasonCode ?? null,
    voidReasonDetails: data.voidDetails?.voidReasonDetails ?? null,
    customFields: customFieldsJson(data.customFields),
  };

  // TODO: Handle multiple properties

  // Separate the data for update and create operations
  // The update operation should not include the id field as it's already in the where clause
  const { id, ...updateData } = row;

  await prisma.invoice.upsert({
    where: { id: data.id },
    update: { ...updateData },
    create: { ...row },
  });

  // Create the necessary relations
  for (const job of data.jobs.nodes) {
    // Invoicing a job changes its status and totals without a JOB_UPDATE
    // webhook, so save the job again rather than only when it's missing
    if (!(await refreshJob(job.id))) {
      continue;
    }

    // Link job to invoice, ignoring if already linked (race-safe)
    try {
      await prisma.jobsOnInvoices.create({
        data: {
          invoice: {
            connect: { id: data.id },
          },
          job: {
            connect: { id: job.id },
          },
        },
      });
      console.log(`Linked job ${job.id} to invoice ${data.id}`);
    } catch (e) {
      if (e.code === "P2002") {
        console.log(`Job ${job.id} already linked to invoice ${data.id}`);
      } else {
        throw e;
      }
    }
  }

  await replaceLineItems("invoice", data.id, data.lineItems);

  console.log("Postgres: Upserted invoice");
}
events.on("db-INVOICE_CREATE_UPDATE", invoiceCreateUpdate);

async function invoiceDestroy(id) {
  const links = await prisma.jobsOnInvoices.findMany({
    where: { invoiceId: id },
  });
  await prisma.lineItem.deleteMany({ where: { invoiceId: id } });
  await prisma.jobsOnInvoices.deleteMany({
    where: { invoiceId: id },
  });
  await prisma.invoice.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed invoice");

  // Deleting the invoice puts its jobs back to needing an invoice, again
  // without a JOB_UPDATE webhook
  for (const { jobId } of links) {
    try {
      await refreshJob(jobId);
    } catch (e) {
      Sentry.captureException(e, { extra: { jobId, invoiceId: id } });
      console.error(`Postgres: Error refreshing job ${jobId}:`, e);
    }
  }
}
events.on("db-INVOICE_DESTROY", invoiceDestroy);

async function ensureInvoiceExists(id) {
  const invoice = await prisma.invoice.findMany({
    where: { id: { equals: id } },
  });

  // Query the API for the invoice and insert it
  if (invoice.length === 0) {
    // Create the invoice
    const apiResponse = await getInvoiceData(id);
    await invoiceCreateUpdate(apiResponse);
  }
}

async function jobCreateUpdate(data) {
  if (data.salesperson) {
    await ensureUserExists(data.salesperson ? data.salesperson.id : null);
  }
  await clientCreateUpdate(data.client);
  await ensurePropertyExists(data.property.id);

  for (const invoice of data.invoices.nodes) {
    console.log("Job has linked invoice!");
    // await ensureInvoiceExists(invoice)
  }

  const row = {
    allowReviewRequest: data.allowReviewRequest,
    clientId: data.client.id,
    completedAt: optionalDate(data.completedAt),
    createdAt: new Date(data.createdAt),
    endAt: optionalDate(data.endAt),
    id: data.id,
    instructions: data.instructions,
    jobNumber: data.jobNumber,
    jobStatus: data.jobStatus,
    jobType: data.jobType,
    jobberWebUri: data.jobberWebUri,
    property: data.property.id,
    salesperson: data.salesperson ? data.salesperson.id : null,
    startAt: optionalDate(data.startAt),
    title: data.title,
    total: data.total,
    uninvoicedTotal: data.uninvoicedTotal,
    updatedAt: new Date(data.updatedAt),
    willClientBeAutomaticallyCharged: data.willClientBeAutomaticallyCharged,
    billingType: data.billingType,
    bookingConfirmationSentAt: optionalDate(data.bookingConfirmationSentAt),
    completedAndUninvoicedVisitsCount: data.completedAndUninvoicedVisitsCount,
    completedAndUninvoicedVisitsTotal: data.completedAndUninvoicedVisitsTotal,
    defaultVisitTitle: data.defaultVisitTitle,
    invoicedTotal: data.invoicedTotal,
    nextDateToSendReviewSms: optionalDate(data.nextDateToSendReviewSms),
    source: data.source,
    quoteId: data.quote?.id ?? null,
    requestId: data.request?.id ?? null,
    outstandingAmount: data.jobBalanceTotals?.outstandingAmount,
    expenseCost: data.jobCosting?.expenseCost,
    labourCost: data.jobCosting?.labourCost,
    labourDuration: data.jobCosting?.labourDuration,
    lineItemCost: data.jobCosting?.lineItemCost,
    profitAmount: data.jobCosting?.profitAmount,
    profitPercentage: data.jobCosting?.profitPercentage,
    totalCost: data.jobCosting?.totalCost,
    totalRevenue: data.jobCosting?.totalRevenue,
    customFields: customFieldsJson(data.customFields),
  };

  // Separate the data for update and create operations
  // The update operation should not include the id field as it's already in the where clause
  const { id, ...updateData } = row;

  try {
    await prisma.job.upsert({
      where: { id: data.id },
      update: { ...updateData },
      create: { ...row },
    });
  } catch (e) {
    // Since Prisma 7.10 the pg adapter reports a 23505's constraint name
    // (`jobs_pk` is the index behind @unique(map:) on jobNumber) rather than its
    // columns, so both are matched.
    if (isUniqueConstraintOn(e, "jobNumber", "jobs_pk")) {
      // Another row already owns this job number. That is either a concurrent
      // insert of this same job, or a job Jobber recreated under a new id —
      // either way the existing row is the one to keep, so update it in place
      // and let the id follow (FKs cascade the update).
      console.log(
        `Postgres: Job id ${data.id} conflicted on jobNumber ${data.jobNumber}, falling back to update by jobNumber`,
      );
      await prisma.job.update({
        where: { jobNumber: data.jobNumber },
        data: { ...updateData, id: data.id },
      });
    } else if (isUniqueConstraintOn(e, "id", "Job_pkey")) {
      // Prisma's upsert isn't atomic, so a concurrent webhook for this same job
      // can insert the row between our update and our create.
      console.log(
        `Postgres: Job ${data.id} was created concurrently, updating instead`,
      );
      await prisma.job.update({
        where: { id: data.id },
        data: { ...updateData },
      });
    } else {
      throw e;
    }
  }
  await replaceLineItems("job", data.id, data.lineItems);
  console.log("Postgres: Upserted job");
}
events.on("db-JOB_CREATE_UPDATE", jobCreateUpdate);

/**
 * Removes a job and its quote/invoice links. Timesheets and expenses on the
 * job are kept with the job reference cleared.
 * @param {string} id - Jobber job ID
 */
async function jobDestroy(id) {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.quotesOnJobs.deleteMany({ where: { jobId: id } });
      await tx.jobsOnInvoices.deleteMany({ where: { jobId: id } });
      await tx.lineItem.deleteMany({ where: { jobId: id } });
      await tx.visit.deleteMany({ where: { jobId: id } });
      await tx.timeSheetEntry.updateMany({
        where: { job: id },
        data: { job: null },
      });
      await tx.expense.updateMany({
        where: { linkedJob: id },
        data: { linkedJob: null },
      });
      await tx.job.deleteMany({ where: { id } });
    });
    console.log("Postgres: Destroyed job");
  } catch (e) {
    Sentry.captureException(e, { extra: { jobId: id } });
    console.error(`Postgres: Error destroying job ${id}:`, e);
  }
}
events.on("db-JOB_DESTROY", jobDestroy);

async function ensureJobExists(id) {
  const job = await prisma.job.findMany({ where: { id: { equals: id } } });

  // Query the API for the job and insert it
  if (job.length === 0) {
    // Create the job
    const apiResponse = await getJobData(id);
    await jobCreateUpdate(apiResponse);
  }
}

/**
 * Saves the job's current Jobber data, whether or not it's stored yet.
 * @param {string} id - Jobber job ID
 * @returns {Promise<boolean>} false when Jobber no longer has the job
 */
async function refreshJob(id) {
  const apiResponse = await getJobData(id);
  if (!apiResponse) {
    console.log(`Postgres: Job ${id} not found in Jobber, not saving it`);
    return false;
  }
  await jobCreateUpdate(apiResponse);
  return true;
}

async function ensureClientExists(id) {
  const client = await prisma.client.findMany({
    where: { id: { equals: id } },
  });

  // Query the API for the client and insert it
  if (client.length === 0) {
    // Create the client
    const apiResponse = await getClientData(id);
    await clientCreateUpdate(apiResponse);
  }
}

async function quoteCreateUpdate(data) {
  if (data.salesperson) {
    await ensureUserExists(data.salesperson.id);
  }
  await ensureClientExists(data.client.id);
  await ensurePropertyExists(data.property.id);

  const row = {
    depositAmount: data.amounts.depositAmount,
    discountAmount: data.amounts.discountAmount,
    nonTaxAmount: data.amounts.nonTaxAmount,
    outstandingDepositAmount: data.amounts.outstandingDepositAmount,
    subtotal: data.amounts.subtotal,
    taxAmount: data.amounts.taxAmount,
    total: data.amounts.total,
    client: { connect: { id: data.client.id } },
    clientHubUri: data.clientHubUri,
    clientHubViewedAt: data.clientHubViewedAt ? data.clientHubViewedAt : null,
    contractDisclaimer: data.contractDisclaimer,
    createdAt: new Date(data.createdAt),
    depositAmountUnallocated: data.depositAmountUnallocated,
    id: data.id,
    jobberWebUri: data.jobberWebUri,
    // jobs:
    approvedAt: optionalDate(data.lastTransitioned?.approvedAt),
    changesRequestedAt: optionalDate(data.lastTransitioned?.changesRequestedAt),
    convertedAt: optionalDate(data.lastTransitioned?.convertedAt),
    message: data.message,
    property: { connect: { id: data.property.id } },
    quoteNumber: Number(data.quoteNumber),
    quoteStatus: data.quoteStatus,
    ...(data.salesperson && {
      salesperson: { connect: { id: data.salesperson.id } },
    }),
    totalTaxAmount: data.taxDetails?.totalTaxAmount ?? null,
    title: data.title,
    updatedAt: new Date(data.updatedAt),
    sentAt: optionalDate(data.sentAt),
    transitionedAt: optionalDate(data.transitionedAt),
    eligibleForFinancing: data.eligibleForFinancing,
    requestId: data.request?.id ?? null,
    customFields: customFieldsJson(data.customFields),
  };

  // Separate the data for update and create operations
  // The update operation should not include the id field as it's already in the where clause
  const { id, ...updateData } = row;

  try {
    await prisma.quote.upsert({
      where: { id: data.id },
      update: { ...updateData },
      create: { ...row },
    });
  } catch (e) {
    // Nested writes (the `connect`s above) force Prisma to emulate the upsert
    // as an update-then-create, which isn't atomic: QUOTE_CREATE and
    // QUOTE_UPDATE arriving together both miss the update and race the create.
    if (!isUniqueConstraintOn(e, "id", "Quote_pkey")) {
      throw e;
    }
    console.log(
      `Postgres: Quote ${data.id} was created concurrently, updating instead`,
    );
    await prisma.quote.update({
      where: { id: data.id },
      data: { ...updateData },
    });
  }

  // Create the necessary relations
  for (const job of data.jobs.nodes) {
    await ensureJobExists(job.id);

    // Link job to quote, ignoring if already linked (race-safe)
    try {
      await prisma.quotesOnJobs.create({
        data: {
          quote: {
            connect: { id: data.id },
          },
          job: {
            connect: { id: job.id },
          },
        },
      });
      console.log(`Linked job ${job.id} to quote ${data.id}`);
    } catch (e) {
      if (e.code === "P2002") {
        console.log(`Job ${job.id} already linked to quote ${data.id}`);
      } else {
        throw e;
      }
    }
  }

  await replaceLineItems("quote", data.id, data.lineItems);

  console.log("Postgres: Upserted quote");
}
events.on("db-QUOTE_CREATE_UPDATE", quoteCreateUpdate);

async function quoteDestroy(id) {
  await prisma.lineItem.deleteMany({ where: { quoteId: id } });
  await prisma.quotesOnJobs.deleteMany({
    where: { quoteId: id },
  });

  await prisma.quote.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed quote");
}
events.on("db-QUOTE_DESTROY", quoteDestroy);

async function paymentCreateUpdate(data) {
  await clientCreateUpdate(data.client);
  if (data.invoice) {
    await ensureInvoiceExists(data.invoice.id);
  }
  // if (data.quote) {
  //   await ensureQuoteExists(data.quote.id);
  // }

  const row = {
    adjustmentType: data.adjustmentType,
    amount: data.amount,
    canEdit: data.canEdit,
    // client: data.client ? data.client.id : null,
    details: data.details,
    entryDate: data.entryDate,
    id: data.id,
    // invoice: data.invoice ? data.invoice.id : null,
    paymentOrigin: data.paymentOrigin,
    // For some reason, Jobber's API makes a payment webhook when the invoice is marked as sent
    paymentType: data.paymentType ? data.paymentType : "NONE",
    sentAt: optionalDate(data.sentAt),
    paymentKind: data.__typename ?? null,
    quote: data.quote?.id ?? null,
    tipAmount: data.tipAmount ?? null,
    rawAmount: data.rawAmount ?? null,
    refundableAmount: data.refundableAmount ?? null,
    clients: data.client ? { connect: { id: data.client.id } } : undefined,
    invoices: data.invoice ? { connect: { id: data.invoice.id } } : undefined,
  };

  // Separate the data for update and create operations
  // The update operation should not include the id field as it's already in the where clause
  const { id, ...updateData } = row;

  await prisma.payment.upsert({
    where: { id: data.id },
    update: { ...updateData },
    create: { ...row },
  });
  console.log("Postgres: Upserted payment");
}
events.on("db-PAYMENT_CREATE_UPDATE", paymentCreateUpdate);

/**
 * Removes a payment. PAYMENT_DESTROY sends gid://Jobber/PaymentRecord/123,
 * while the payment was stored under its type (e.g.
 * gid://Jobber/CheckPaymentRecord/123), so it's matched by the number.
 * @param {string} id - Jobber payment ID from the webhook
 */
async function paymentDestroy(id) {
  try {
    const number = Buffer.from(id, "base64")
      .toString()
      .match(/PaymentRecord\/(\d+)$/)?.[1];
    if (!number) {
      console.error(`Postgres: Can't read a payment number from ${id}`);
      return;
    }
    const rows = await prisma.$queryRaw`
      SELECT id FROM "Payment"
      WHERE convert_from(decode(id, 'base64'), 'UTF8') LIKE ${`%PaymentRecord/${number}`}`;
    if (rows.length === 0) {
      console.log("Postgres: Payment not found in DB, nothing to delete");
      return;
    }
    await prisma.payment.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    console.log("Postgres: Destroyed payment");
  } catch (e) {
    Sentry.captureException(e, { extra: { paymentId: id } });
    console.error(`Postgres: Error destroying payment ${id}:`, e);
  }
}
events.on("db-PAYMENT_DESTROY", paymentDestroy);

async function propertyCreateUpdate(data) {
  await clientCreateUpdate(data.client);
  await propertyUpsert(data);
}
events.on("db-PROPERTY_CREATE_UPDATE", propertyCreateUpdate);

async function propertyDestroy(id) {
  try {
    // A merge moves the property's jobs and quotes to the one Jobber keeps,
    // and their updates can arrive after this destroy
    await resaveFromJobber(
      "jobs",
      await storedIds("job", { property: id }),
      getJobData,
      jobCreateUpdate,
    );
    await resaveFromJobber(
      "quotes",
      await storedIds("quote", { propertyId: id }),
      getQuoteData,
      quoteCreateUpdate,
    );
    await prisma.property.deleteMany({
      where: { id: id },
    });
    console.log("Postgres: Destroyed property");
  } catch (e) {
    // Fails if quotes or jobs Jobber still has reference the property
    Sentry.captureException(e, { extra: { propertyId: id } });
    console.error(`Postgres: Error destroying property ${id}:`, e);
  }
}
events.on("db-PROPERTY_DESTROY", propertyDestroy);

async function expenseCreateUpdate(data) {
  // Jobber returns no enteredBy on some older expenses
  let userReferences = [];
  if (data.enteredBy) {
    userReferences.push(data.enteredBy.id);
  }
  if (data.paidBy) {
    userReferences.push(data.paidBy.id);
  }
  if (data.reimbursableTo) {
    userReferences.push(data.reimbursableTo.id);
  }
  for (const userReference of userReferences) {
    await ensureUserExists(userReference);
  }

  if (data.linkedJob) {
    await ensureJobExists(data.linkedJob.id);
  }

  const row = {
    createdAt: new Date(data.createdAt),
    date: new Date(data.date),
    description: data.description,
    enteredBy: data.enteredBy ? data.enteredBy.id : null,
    id: data.id,
    linkedJob: data.linkedJob ? data.linkedJob.id : null,
    paidBy: data.paidBy ? data.paidBy.id : null,
    reimbursableTo: data.reimbursableTo ? data.reimbursableTo.id : null,
    title: data.title,
    total: data.total,
    updatedAt: new Date(data.updatedAt),
  };
  // Separate the data for update and create operations
  // The update operation should not include the id field as it's already in the where clause
  const { id, ...updateData } = row;

  await prisma.expense.upsert({
    where: { id: data.id },
    update: { ...updateData },
    create: { ...row },
  });
  console.log("Postgres: Upserted expense");
}
events.on("db-EXPENSE_CREATE_UPDATE", expenseCreateUpdate);

async function expenseDestroy(id) {
  await prisma.expense.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed expense");
}
events.on("db-EXPENSE_DESTROY", expenseDestroy);

async function timesheetCreateUpdate(data) {
  try {
    await upsertTimesheet(data);
  } catch (e) {
    Sentry.captureException(e, { extra: { timesheetId: data?.id } });
    console.error(`Postgres: Error upserting timesheet ${data?.id}:`, e);
  }
}
events.on("db-TIMESHEET_CREATE_UPDATE", timesheetCreateUpdate);

async function upsertTimesheet(data) {
  if (data.approvedBy) {
    await ensureUserExists(data.approvedBy.id);
  }
  if (data.client) {
    await ensureClientExists(data.client.id);
  }
  if (data.job) {
    await ensureJobExists(data.job.id);
  }
  if (data.paidBy) {
    await ensureUserExists(data.paidBy.id);
  }
  if (data.user) {
    await ensureUserExists(data.user.id);
  }
  // if (data.visit) {
  //   await ensureVisitExists(data.visit.id);
  // }

  const row = {
    approved: data.approved,
    approvedByUser: data.approvedBy
      ? { connect: { id: data.approvedBy.id } }
      : undefined,
    clients: data.client ? { connect: { id: data.client.id } } : undefined,
    createdAt: optionalDate(data.createdAt),
    endAt: optionalDate(data.endAt),
    finalDuration: data.finalDuration,
    id: data.id,
    jobs: data.job ? { connect: { id: data.job.id } } : undefined,
    label: data.label,
    laborRate: data.labourRate,
    note: data.note,
    paidByUser: data.paidBy ? { connect: { id: data.paidBy.id } } : undefined,
    startAt: optionalDate(data.startAt),
    ticking: data.ticking,
    updatedAt: data.updatedAt,
    users: data.user ? { connect: { id: data.user.id } } : undefined,
    visit: data.visit?.id ?? null,
    visitDurationTotal: data.visitDurationTotal,
    payable: data.payable,
    timeSheetCategory: data.timeSheetCategory ?? null,
    targetType: data.targetType ?? null,
  };
  // Separate the data for update and create operations
  // The update operation should not include the id field as it's already in the where clause
  const { id, ...updateData } = row;

  try {
    await prisma.timeSheetEntry.upsert({
      where: { id: data.id },
      update: { ...updateData },
      create: { ...row },
    });
  } catch (e) {
    // The connects above make Prisma emulate the upsert as update-then-create,
    // so TIMESHEET_CREATE and TIMESHEET_UPDATE arriving together race the create.
    if (!isUniqueConstraintOn(e, "id", "TimeSheetEntry_pkey")) {
      throw e;
    }
    console.log(
      `Postgres: Timesheet ${data.id} was created concurrently, updating instead`,
    );
    await prisma.timeSheetEntry.update({
      where: { id: data.id },
      data: { ...updateData },
    });
  }
  console.log("Postgres: Upserted timesheet");
}

async function timesheetDestroy(id) {
  try {
    await prisma.timeSheetEntry.deleteMany({
      where: { id: id },
    });
    console.log("Postgres: Destroyed timesheet");
  } catch (e) {
    Sentry.captureException(e, { extra: { timesheetId: id } });
    console.error(`Postgres: Error destroying timesheet ${id}:`, e);
  }
}
events.on("db-TIMESHEET_DESTROY", timesheetDestroy);

/**
 * Saves a visit. Visits, requests and products are stored without foreign
 * keys, so they're saved without first fetching what they reference.
 * @param {object} data - From Jobber.getVisitData
 */
async function visitCreateUpdate(data) {
  try {
    const row = {
      jobId: data.job?.id ?? null,
      clientId: data.client?.id ?? null,
      propertyId: data.property?.id ?? null,
      invoiceId: data.invoice?.id ?? null,
      title: data.title ?? null,
      instructions: data.instructions ?? null,
      startAt: optionalDate(data.startAt),
      endAt: optionalDate(data.endAt),
      completedAt: optionalDate(data.completedAt),
      completedBy: data.completedBy ?? null,
      createdAt: optionalDate(data.createdAt),
      createdById: data.createdBy?.id ?? null,
      duration: data.duration ?? null,
      allDay: data.allDay ?? null,
      isComplete: data.isComplete ?? null,
      isRecurring: data.isRecurring ?? null,
      isLastScheduledVisit: data.isLastScheduledVisit ?? null,
      clientConfirmed: data.clientConfirmed ?? null,
      visitStatus: data.visitStatus ?? null,
      arrivalWindowStartAt: optionalDate(data.arrivalWindow?.startAt),
      arrivalWindowEndAt: optionalDate(data.arrivalWindow?.endAt),
      assignedUserIds: (data.assignedUsers?.nodes ?? []).map((u) => u.id),
    };
    await prisma.visit.upsert({
      where: { id: data.id },
      update: row,
      create: { id: data.id, ...row },
    });
    console.log("Postgres: Upserted visit");
  } catch (e) {
    Sentry.captureException(e, { extra: { visitId: data?.id } });
    console.error(`Postgres: Error upserting visit ${data?.id}:`, e);
  }
}
events.on("db-VISIT_CREATE_UPDATE", visitCreateUpdate);

async function visitDestroy(id) {
  try {
    await prisma.visit.deleteMany({ where: { id } });
    console.log("Postgres: Destroyed visit");
  } catch (e) {
    Sentry.captureException(e, { extra: { visitId: id } });
    console.error(`Postgres: Error destroying visit ${id}:`, e);
  }
}
events.on("db-VISIT_DESTROY", visitDestroy);

/**
 * Saves a request.
 * @param {object} data - From Jobber.getRequestData
 */
async function requestCreateUpdate(data) {
  try {
    const row = {
      clientId: data.client?.id ?? null,
      propertyId: data.property?.id ?? null,
      referringClientId: data.referringClient?.id ?? null,
      salespersonId: data.salesperson?.id ?? null,
      title: data.title ?? null,
      companyName: data.companyName ?? null,
      contactName: data.contactName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      source: data.source ?? null,
      requestStatus: data.requestStatus ?? null,
      isArchivable: data.isArchivable ?? null,
      isScheduled: data.isScheduled ?? null,
      total: data.amounts?.total ?? null,
      jobberWebUri: data.jobberWebUri ?? null,
      createdAt: optionalDate(data.createdAt),
      updatedAt: optionalDate(data.updatedAt),
    };
    await prisma.request.upsert({
      where: { id: data.id },
      update: row,
      create: { id: data.id, ...row },
    });
    console.log("Postgres: Upserted request");
  } catch (e) {
    Sentry.captureException(e, { extra: { requestId: data?.id } });
    console.error(`Postgres: Error upserting request ${data?.id}:`, e);
  }
}
events.on("db-REQUEST_CREATE_UPDATE", requestCreateUpdate);

async function requestDestroy(id) {
  try {
    await prisma.request.deleteMany({ where: { id } });
    console.log("Postgres: Destroyed request");
  } catch (e) {
    Sentry.captureException(e, { extra: { requestId: id } });
    console.error(`Postgres: Error destroying request ${id}:`, e);
  }
}
events.on("db-REQUEST_DESTROY", requestDestroy);

/**
 * Saves a product or service from the products and services list.
 * @param {object} data - From Jobber.getProductOrServiceData
 */
async function productOrServiceCreateUpdate(data) {
  try {
    const row = {
      name: data.name ?? null,
      description: data.description ?? null,
      category: data.category ?? null,
      defaultUnitCost: data.defaultUnitCost ?? null,
      internalUnitCost: data.internalUnitCost ?? null,
      markup: data.markup ?? null,
      durationMinutes: data.durationMinutes ?? null,
      taxable: data.taxable ?? null,
      visible: data.visible ?? null,
      customFields: customFieldsJson(data.customFields),
    };
    await prisma.productOrService.upsert({
      where: { id: data.id },
      update: row,
      create: { id: data.id, ...row },
    });
    console.log("Postgres: Upserted product or service");
  } catch (e) {
    Sentry.captureException(e, { extra: { productOrServiceId: data?.id } });
    console.error(
      `Postgres: Error upserting product or service ${data?.id}:`,
      e,
    );
  }
}
events.on("db-PRODUCT_OR_SERVICE_CREATE_UPDATE", productOrServiceCreateUpdate);

async function productOrServiceDestroy(id) {
  try {
    await prisma.productOrService.deleteMany({ where: { id } });
    console.log("Postgres: Destroyed product or service");
  } catch (e) {
    Sentry.captureException(e, { extra: { productOrServiceId: id } });
    console.error(`Postgres: Error destroying product or service ${id}:`, e);
  }
}
events.on("db-PRODUCT_OR_SERVICE_DESTROY", productOrServiceDestroy);
