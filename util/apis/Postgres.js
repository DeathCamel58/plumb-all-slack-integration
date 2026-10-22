import events from "../events.js";
import * as Sentry from "@sentry/node";

import prisma from "../prismaClient.js";
import {
  getUserData,
  getPropertyData,
  getJobData,
  getInvoiceData,
  getClientData,
} from "./Jobber.js";
import {
  uniqueConstraintFields,
  isUniqueConstraintOn,
} from "../prismaErrors.js";

export { uniqueConstraintFields, isUniqueConstraintOn };

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

async function ensureUserExists(id) {
  const user = await prisma.user.findMany({ where: { id: { equals: id } } });

  // Query the API for the user and insert it
  if (user.length === 0) {
    // Create the user
    const apiResponse = await getUserData(id);
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
 * Removes a client and everything of theirs. Link rows and payments are
 * deleted before the rows they point at, and timesheets and expenses (which
 * belong to employees) are kept with their client and job references cleared.
 * @param {string} id - Jobber client ID
 */
async function clientDestroy(id) {
  try {
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
    clientId: data.client.id,
    createdAt: new Date(data.createdAt),
    dueDate: new Date(data.dueDate),
    id: data.id,
    invoiceNet: data.invoiceNet,
    invoiceNumber: Number(data.invoiceNumber),
    invoiceStatus: data.invoiceStatus,
    issuedDate: new Date(data.issuedDate),
    jobberWebUri: data.jobberWebUri,
    message: data.message,
    receivedDate: new Date(data.receivedDate),
    salesperson: data.salesperson ? data.salesperson.id : null,
    subject: data.subject,
    updatedAt: new Date(data.updatedAt),
    // jobs:
    // payments:
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
    await ensureJobExists(job.id);

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

  console.log("Postgres: Upserted invoice");
}
events.on("db-INVOICE_CREATE_UPDATE", invoiceCreateUpdate);

async function invoiceDestroy(id) {
  await prisma.jobsOnInvoices.deleteMany({
    where: { invoiceId: id },
  });
  await prisma.invoice.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed invoice");
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
    completedAt: new Date(data.completedAt),
    createdAt: new Date(data.createdAt),
    endAt: new Date(data.endAt),
    id: data.id,
    instructions: data.instructions,
    jobNumber: data.jobNumber,
    jobStatus: data.jobStatus,
    jobType: data.jobType,
    jobberWebUri: data.jobberWebUri,
    property: data.property.id,
    salesperson: data.salesperson ? data.salesperson.id : null,
    startAt: new Date(data.startAt),
    title: data.title,
    total: data.total,
    uninvoicedTotal: data.uninvoicedTotal,
    updatedAt: new Date(data.updatedAt),
    willClientBeAutomaticallyCharged: data.willClientBeAutomaticallyCharged,
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
    // `jobs_pk` is the index name behind @unique(map:) on jobNumber. The pg
    // adapter always reports columns rather than the index for a 23505, so it
    // is only matched in case we ever move back to the query engine, which
    // reports constraint names instead.
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
    } else if (isUniqueConstraintOn(e, "id")) {
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
    approvedAt: data.approvedAt ? new Date(data.approvedAt) : null,
    changesRequestedAt: data.changesRequestedAt
      ? new Date(data.changesRequestedAt)
      : null,
    convertedAt: data.convertedAt ? new Date(data.convertedAt) : null,
    message: data.message,
    property: { connect: { id: data.property.id } },
    quoteNumber: Number(data.quoteNumber),
    quoteStatus: data.quoteStatus,
    ...(data.salesperson && {
      salesperson: { connect: { id: data.salesperson.id } },
    }),
    totalTaxAmount: data.totalTaxAmount,
    title: data.title,
    updatedAt: new Date(data.updatedAt),
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
    if (!isUniqueConstraintOn(e, "id")) {
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

  console.log("Postgres: Upserted quote");
}
events.on("db-QUOTE_CREATE_UPDATE", quoteCreateUpdate);

async function quoteDestroy(id) {
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
    // quote: data.quote.id ? data.quote : null,
    sentAt: new Date(data.sentAt),
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

// TODO: Figure payment destroys
// This is having an issue, as the Jobber API doesn't give us the payment ID they used initially
async function paymentDestroy(id) {
  await prisma.payment.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed payment");
}
// events.on("db-PAYMENT_DESTROY", paymentDestroy);

async function propertyCreateUpdate(data) {
  await clientCreateUpdate(data.client);
  await propertyUpsert(data);
}
events.on("db-PROPERTY_CREATE_UPDATE", propertyCreateUpdate);

async function propertyDestroy(id) {
  try {
    await prisma.property.deleteMany({
      where: { id: id },
    });
    console.log("Postgres: Destroyed property");
  } catch (e) {
    // Fails if quotes or jobs still reference the property
    Sentry.captureException(e, { extra: { propertyId: id } });
    console.error(`Postgres: Error destroying property ${id}:`, e);
  }
}
events.on("db-PROPERTY_DESTROY", propertyDestroy);

async function expenseCreateUpdate(data) {
  let userReferences = [data.enteredBy.id];
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
    enteredBy: data.enteredBy.id,
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

/**
 * Parses an optional Jobber timestamp. `new Date(null)` is the epoch, so a
 * missing value (e.g. endAt on a running timer) must stay null instead.
 * @param {string|null|undefined} value
 * @returns {Date|null}
 */
function optionalDate(value) {
  return value ? new Date(value) : null;
}

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
    // visits: data.visit ? { connect: { id: data.visit.id } } : undefined,
    visitDurationTotal: data.visitDurationTotal,
  };
  // Separate the data for update and create operations
  // The update operation should not include the id field as it's already in the where clause
  const { id, ...updateData } = row;

  await prisma.timeSheetEntry.upsert({
    where: { id: data.id },
    update: { ...updateData },
    create: { ...row },
  });
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
