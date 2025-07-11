require("dotenv").config({
  path: process.env.ENV_LOCATION || "/root/plumb-all-slack-integration/.env",
});
const events = require("../events");
const Sentry = require("@sentry/node");

const PrismaClient = require("../../generated/prisma");
const {
  getUserData,
  getPropertyData,
  getJobData,
  getInvoiceData,
  getClientData,
} = require("./Jobber");
const prisma = new PrismaClient.PrismaClient();

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
  await prisma.user.upsert({
    where: { id: data.id },
    update: { ...row },
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
      ? data.address.coordinates.longitude
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
  await prisma.property.upsert({
    where: { id: data.id },
    update: { ...row },
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
  await prisma.client.upsert({
    where: { id: data.id },
    update: { ...row },
    create: { ...row },
  });
  console.log("Postgres: Upserted client");
}
events.emitter.on("db-CLIENT_CREATE_UPDATE", clientCreateUpdate);

async function clientDestroy(id) {
  // Delete all related quotes
  await prisma.quote.deleteMany({
    where: { clientId: id },
  });

  // Delete all related jobs
  await prisma.job.deleteMany({
    where: { clientId: id },
  });

  // Delete all related invoices
  await prisma.invoice.deleteMany({
    where: { clientId: id },
  });

  // Delete all related properties
  await prisma.property.deleteMany({
    where: { client: id },
  });

  // Now safely delete the client
  await prisma.client.delete({
    where: { id },
  });
  console.log("Postgres: Destroyed client");
}
events.emitter.on("db-CLIENT_DESTROY", clientDestroy);

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

  await prisma.invoice.upsert({
    where: { id: data.id },
    update: { ...row },
    create: { ...row },
  });

  // Create the necessary relations
  for (const job of data.jobs.nodes) {
    await ensureJobExists(job.id);

    // Check if this job-invoice relation already exists
    const existing = await prisma.jobsOnInvoices.findUnique({
      where: {
        invoiceId_jobId: {
          invoiceId: data.id,
          jobId: job.id,
        },
      },
    });

    // Create it if it doesn't exist
    if (!existing) {
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
    } else {
      console.log(`Job ${job.id} already linked to invoice ${data.id}`);
    }
  }

  console.log("Postgres: Upserted invoice");
}
events.emitter.on("db-INVOICE_CREATE_UPDATE", invoiceCreateUpdate);

async function invoiceDestroy(id) {
  await prisma.jobsOnInvoices.deleteMany({
    where: { invoiceId: id },
  });
  await prisma.invoice.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed invoice");
}
events.emitter.on("db-INVOICE_DESTROY", invoiceDestroy);

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

  await prisma.job.upsert({
    where: { id: data.id },
    update: { ...row },
    create: { ...row },
  });
  console.log("Postgres: Upserted job");
}
events.emitter.on("db-JOB_CREATE_UPDATE", jobCreateUpdate);

async function jobDestroy(id) {
  await prisma.quotesOnJobs.deleteMany({
    where: { jobId: id },
  });

  await prisma.jobsOnInvoices.deleteMany({
    where: { jobId: id },
  });

  await prisma.job.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed job");
}
events.emitter.on("db-JOB_DESTROY", invoiceDestroy);

async function ensureJobExists(id) {
  const job = await prisma.user.findMany({ where: { id: { equals: id } } });

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

  await prisma.quote.upsert({
    where: { id: data.id },
    update: { ...row },
    create: { ...row },
  });

  // Create the necessary relations
  for (const job of data.jobs.nodes) {
    await ensureJobExists(job.id);

    // Check if this job-invoice relation already exists
    const existing = await prisma.quotesOnJobs.findUnique({
      where: {
        jobId_quoteId: {
          quoteId: data.id,
          jobId: job.id,
        },
      },
    });

    // Create it if it doesn't exist
    if (!existing) {
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
    } else {
      console.log(`Job ${job.id} already linked to quote ${data.id}`);
    }
  }

  console.log("Postgres: Upserted quote");
}
events.emitter.on("db-QUOTE_CREATE_UPDATE", quoteCreateUpdate);

async function quoteDestroy(id) {
  await prisma.quotesOnJobs.deleteMany({
    where: { quoteId: id },
  });

  await prisma.quote.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed quote");
}
events.emitter.on("db-QUOTE_DESTROY", quoteDestroy);

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

  await prisma.payment.upsert({
    where: { id: data.id },
    update: { ...row },
    create: { ...row },
  });
  console.log("Postgres: Upserted payment");
}
events.emitter.on("db-PAYMENT_CREATE_UPDATE", paymentCreateUpdate);

// TODO: Figure payment destroys
// This is having an issue, as the Jobber API doesn't give us the payment ID they used initially
async function paymentDestroy(id) {
  await prisma.payment.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed payment");
}
// events.emitter.on("db-PAYMENT_DESTROY", paymentDestroy);

async function propertyCreateUpdate(data) {
  await clientCreateUpdate(data.client);
  await propertyUpsert(data);
}
events.emitter.on("db-PROPERTY_CREATE_UPDATE", propertyCreateUpdate);

async function propertyDestroy(id) {
  await prisma.property.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed property");
}
events.emitter.on("db-EXPENSE_DESTROY", propertyDestroy);

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
  await prisma.expense.upsert({
    where: { id: data.id },
    update: { ...row },
    create: { ...row },
  });
  console.log("Postgres: Upserted expense");
}
events.emitter.on("db-EXPENSE_CREATE_UPDATE", expenseCreateUpdate);

async function expenseDestroy(id) {
  await prisma.expense.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed expense");
}
events.emitter.on("db-EXPENSE_DESTROY", expenseDestroy);

async function timesheetCreateUpdate(data) {
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
    createdAt: new Date(data.createdAt),
    endAt: new Date(data.endAt),
    finalDuration: data.finalDuration,
    id: data.id,
    jobs: data.job ? { connect: { id: data.job.id } } : undefined,
    label: data.label,
    laborRate: data.labourRate,
    note: data.note,
    paidByUser: data.paidBy ? { connect: { id: data.paidBy.id } } : undefined,
    startAt: new Date(data.startAt),
    ticking: data.ticking,
    updatedAt: data.updatedAt,
    users: data.user ? { connect: { id: data.user.id } } : undefined,
    // visits: data.visit ? { connect: { id: data.visit.id } } : undefined,
    visitDurationTotal: data.visitDurationTotal,
  };
  await prisma.timeSheetEntry.upsert({
    where: { id: data.id },
    update: { ...row },
    create: { ...row },
  });
  console.log("Postgres: Upserted timesheet");
}
events.emitter.on("db-TIMESHEET_CREATE_UPDATE", timesheetCreateUpdate);

async function timesheetDestroy(id) {
  await prisma.timeSheetEntry.deleteMany({
    where: { id: id },
  });
  console.log("Postgres: Destroyed timesheet");
}
events.emitter.on("db-TIMESHEET_DESTROY", timesheetDestroy);
