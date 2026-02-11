-- CreateTable
CREATE TABLE "Client" (
    "companyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "firstName" TEXT,
    "id" TEXT NOT NULL,
    "isArchivable" BOOLEAN NOT NULL,
    "isArchived" BOOLEAN NOT NULL,
    "isCompany" BOOLEAN NOT NULL,
    "isLead" BOOLEAN NOT NULL,
    "lastName" TEXT,
    "name" TEXT,
    "title" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "jobberWebUri" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "createdAt" TIMESTAMP(3) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "enteredBy" TEXT,
    "id" TEXT NOT NULL,
    "linkedJob" TEXT,
    "paidBy" TEXT,
    "reimbursableTo" TEXT,
    "title" TEXT,
    "total" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "depositAmount" DOUBLE PRECISION NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL,
    "invoiceBalance" DOUBLE PRECISION NOT NULL,
    "paymentsTotal" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "invoiceNet" INTEGER,
    "invoiceNumber" INTEGER NOT NULL,
    "invoiceStatus" TEXT NOT NULL,
    "issuedDate" TIMESTAMP(3),
    "jobberWebUri" TEXT,
    "message" TEXT,
    "receivedDate" TIMESTAMP(3),
    "salesperson" TEXT,
    "subject" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobsOnInvoices" (
    "invoiceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "JobsOnInvoices_pkey" PRIMARY KEY ("invoiceId","jobId")
);

-- CreateTable
CREATE TABLE "Job" (
    "allowReviewRequest" BOOLEAN NOT NULL,
    "clientId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "id" TEXT NOT NULL,
    "instructions" TEXT,
    "jobNumber" INTEGER NOT NULL,
    "jobStatus" TEXT,
    "jobType" TEXT,
    "jobberWebUri" TEXT,
    "property" TEXT NOT NULL,
    "salesperson" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "total" DOUBLE PRECISION NOT NULL,
    "uninvoicedTotal" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "willClientBeAutomaticallyCharged" BOOLEAN NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotesOnJobs" (
    "quoteId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "QuotesOnJobs_pkey" PRIMARY KEY ("jobId","quoteId")
);

-- CreateTable
CREATE TABLE "Quote" (
    "depositAmount" DOUBLE PRECISION,
    "discountAmount" DOUBLE PRECISION,
    "nonTaxAmount" DOUBLE PRECISION,
    "outstandingDepositAmount" DOUBLE PRECISION,
    "subtotal" DOUBLE PRECISION,
    "taxAmount" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "clientId" TEXT NOT NULL,
    "clientHubUri" TEXT NOT NULL,
    "clientHubViewedAt" TIMESTAMP(3),
    "contractDisclaimer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "depositAmountUnallocated" DOUBLE PRECISION NOT NULL,
    "id" TEXT NOT NULL,
    "jobberWebUri" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "changesRequestedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "message" TEXT,
    "propertyId" TEXT NOT NULL,
    "quoteNumber" INTEGER NOT NULL,
    "quoteStatus" TEXT NOT NULL,
    "salespersonId" TEXT,
    "totalTaxAmount" DOUBLE PRECISION,
    "title" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "adjustmentType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "canEdit" BOOLEAN NOT NULL,
    "client" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "id" TEXT NOT NULL,
    "invoice" TEXT,
    "paymentOrigin" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "paymentType" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "city" TEXT,
    "country" TEXT,
    "id" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "postalCode" TEXT,
    "province" TEXT,
    "street" TEXT,
    "isBillingAddress" BOOLEAN NOT NULL,
    "jobberWebUri" TEXT NOT NULL,
    "client" TEXT NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "createdAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "isAccountAdmin" BOOLEAN NOT NULL,
    "isAccountOwner" BOOLEAN NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "earnsCommission" BOOLEAN NOT NULL DEFAULT false,
    "commissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hourlyRate" DOUBLE PRECISION,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeSheetEntry" (
    "approved" BOOLEAN,
    "approvedBy" TEXT,
    "client" TEXT,
    "createdAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3) NOT NULL,
    "finalDuration" INTEGER NOT NULL,
    "id" TEXT NOT NULL,
    "job" TEXT,
    "label" TEXT,
    "laborRate" DOUBLE PRECISION,
    "note" TEXT NOT NULL,
    "paidBy" TEXT,
    "startAt" TIMESTAMP(3),
    "ticking" BOOLEAN,
    "updatedAt" TIMESTAMP(3),
    "user" TEXT,
    "visit" TEXT,
    "visitDurationTotal" INTEGER,

    CONSTRAINT "TimeSheetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwilioNumber" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "assignedEmployee" TEXT,
    "assignedEmployeeNumber" TEXT,
    "assignedEmployeeName" TEXT,

    CONSTRAINT "TwilioNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwilioContact" (
    "id" TEXT NOT NULL,
    "clientNumber" TEXT NOT NULL,
    "slackThreadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "lastContactAt" TIMESTAMP(3) NOT NULL,
    "twilioNumberId" TEXT,

    CONSTRAINT "TwilioContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_pk" ON "Job"("jobNumber");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_pk" ON "Quote"("quoteNumber");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_enteredBy_fkey" FOREIGN KEY ("enteredBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_linkedJob_fkey" FOREIGN KEY ("linkedJob") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paidBy_fkey" FOREIGN KEY ("paidBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_reimbursableTo_fkey" FOREIGN KEY ("reimbursableTo") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salesperson_fkey" FOREIGN KEY ("salesperson") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobsOnInvoices" ADD CONSTRAINT "JobsOnInvoices_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobsOnInvoices" ADD CONSTRAINT "JobsOnInvoices_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_property_fkey" FOREIGN KEY ("property") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_salesperson_fkey" FOREIGN KEY ("salesperson") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotesOnJobs" ADD CONSTRAINT "QuotesOnJobs_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotesOnJobs" ADD CONSTRAINT "QuotesOnJobs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSheetEntry" ADD CONSTRAINT "TimeSheetEntry_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSheetEntry" ADD CONSTRAINT "TimeSheetEntry_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSheetEntry" ADD CONSTRAINT "TimeSheetEntry_job_fkey" FOREIGN KEY ("job") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSheetEntry" ADD CONSTRAINT "TimeSheetEntry_paidBy_fkey" FOREIGN KEY ("paidBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSheetEntry" ADD CONSTRAINT "TimeSheetEntry_user_fkey" FOREIGN KEY ("user") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwilioContact" ADD CONSTRAINT "TwilioContact_twilioNumberId_fkey" FOREIGN KEY ("twilioNumberId") REFERENCES "TwilioNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
