-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "balance" DOUBLE PRECISION,
ADD COLUMN     "billingCity" TEXT,
ADD COLUMN     "billingCountry" TEXT,
ADD COLUMN     "billingPostalCode" TEXT,
ADD COLUMN     "billingProvince" TEXT,
ADD COLUMN     "billingStreet" TEXT,
ADD COLUMN     "billingStreet1" TEXT,
ADD COLUMN     "billingStreet2" TEXT,
ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "emails" JSONB,
ADD COLUMN     "leadSource" TEXT,
ADD COLUMN     "phones" JSONB,
ADD COLUMN     "receivesFollowUps" BOOLEAN,
ADD COLUMN     "receivesInvoiceFollowUps" BOOLEAN,
ADD COLUMN     "receivesQuoteFollowUps" BOOLEAN,
ADD COLUMN     "receivesReminders" BOOLEAN,
ADD COLUMN     "receivesReviewRequests" BOOLEAN,
ADD COLUMN     "secondaryName" TEXT,
ADD COLUMN     "sourceMetadata" JSONB,
ADD COLUMN     "sourceText" TEXT,
ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "utmMedium" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "allowReviewRequest" BOOLEAN,
ADD COLUMN     "billingCity" TEXT,
ADD COLUMN     "billingCountry" TEXT,
ADD COLUMN     "billingPostalCode" TEXT,
ADD COLUMN     "billingProvince" TEXT,
ADD COLUMN     "billingStreet" TEXT,
ADD COLUMN     "billingStreet1" TEXT,
ADD COLUMN     "billingStreet2" TEXT,
ADD COLUMN     "clientHubUri" TEXT,
ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "dateViewedInClientHub" TIMESTAMP(3),
ADD COLUMN     "legacyDiscountAmount" DOUBLE PRECISION,
ADD COLUMN     "nonTaxAmount" DOUBLE PRECISION,
ADD COLUMN     "taxAmount" DOUBLE PRECISION,
ADD COLUMN     "tipsTotal" DOUBLE PRECISION,
ADD COLUMN     "voidReasonCode" TEXT,
ADD COLUMN     "voidReasonDetails" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "waitingForFinancedPayment" BOOLEAN;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "billingType" TEXT,
ADD COLUMN     "bookingConfirmationSentAt" TIMESTAMP(3),
ADD COLUMN     "completedAndUninvoicedVisitsCount" INTEGER,
ADD COLUMN     "completedAndUninvoicedVisitsTotal" DOUBLE PRECISION,
ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "defaultVisitTitle" TEXT,
ADD COLUMN     "expenseCost" DOUBLE PRECISION,
ADD COLUMN     "invoicedTotal" DOUBLE PRECISION,
ADD COLUMN     "labourCost" DOUBLE PRECISION,
ADD COLUMN     "labourDuration" INTEGER,
ADD COLUMN     "lineItemCost" DOUBLE PRECISION,
ADD COLUMN     "nextDateToSendReviewSms" TIMESTAMP(3),
ADD COLUMN     "outstandingAmount" DOUBLE PRECISION,
ADD COLUMN     "profitAmount" DOUBLE PRECISION,
ADD COLUMN     "profitPercentage" DOUBLE PRECISION,
ADD COLUMN     "quoteId" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "totalCost" DOUBLE PRECISION,
ADD COLUMN     "totalRevenue" DOUBLE PRECISION,
ALTER COLUMN "completedAt" DROP NOT NULL,
ALTER COLUMN "endAt" DROP NOT NULL,
ALTER COLUMN "startAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "eligibleForFinancing" BOOLEAN,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "transitionedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paymentKind" TEXT,
ADD COLUMN     "quote" TEXT,
ADD COLUMN     "rawAmount" DOUBLE PRECISION,
ADD COLUMN     "refundableAmount" DOUBLE PRECISION,
ADD COLUMN     "tipAmount" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "createdAt" TIMESTAMP(3),
ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "routingOrder" INTEGER,
ADD COLUMN     "street1" TEXT,
ADD COLUMN     "street2" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "addressCity" TEXT,
ADD COLUMN     "addressCountry" TEXT,
ADD COLUMN     "addressPostalCode" TEXT,
ADD COLUMN     "addressProvince" TEXT,
ADD COLUMN     "addressStreet" TEXT,
ADD COLUMN     "assignedColor" TEXT,
ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3),
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "uuid" TEXT;

-- AlterTable
ALTER TABLE "TimeSheetEntry" ADD COLUMN     "payable" BOOLEAN,
ADD COLUMN     "targetType" TEXT,
ADD COLUMN     "timeSheetCategory" TEXT;

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "clientId" TEXT,
    "propertyId" TEXT,
    "invoiceId" TEXT,
    "title" TEXT,
    "instructions" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3),
    "createdById" TEXT,
    "duration" INTEGER,
    "allDay" BOOLEAN,
    "isComplete" BOOLEAN,
    "isRecurring" BOOLEAN,
    "isLastScheduledVisit" BOOLEAN,
    "clientConfirmed" BOOLEAN,
    "visitStatus" TEXT,
    "arrivalWindowStartAt" TIMESTAMP(3),
    "arrivalWindowEndAt" TIMESTAMP(3),
    "assignedUserIds" TEXT[],

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "propertyId" TEXT,
    "referringClientId" TEXT,
    "salespersonId" TEXT,
    "title" TEXT,
    "companyName" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT,
    "requestStatus" TEXT,
    "isArchivable" BOOLEAN,
    "isScheduled" BOOLEAN,
    "total" DOUBLE PRECISION,
    "jobberWebUri" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineItem" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quoteId" TEXT,
    "jobId" TEXT,
    "invoiceId" TEXT,
    "productOrServiceId" TEXT,
    "jobLineItemId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "category" TEXT,
    "quantity" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION,
    "unitCost" DOUBLE PRECISION,
    "totalPrice" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "originalCost" DOUBLE PRECISION,
    "markup" DOUBLE PRECISION,
    "taxable" BOOLEAN,
    "optional" BOOLEAN,
    "recommended" BOOLEAN,
    "textOnly" BOOLEAN,
    "sortOrder" INTEGER,
    "date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "LineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOrService" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "category" TEXT,
    "defaultUnitCost" DOUBLE PRECISION,
    "internalUnitCost" DOUBLE PRECISION,
    "markup" DOUBLE PRECISION,
    "durationMinutes" INTEGER,
    "taxable" BOOLEAN,
    "visible" BOOLEAN,
    "customFields" JSONB,

    CONSTRAINT "ProductOrService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visit_jobId_idx" ON "Visit"("jobId");

-- CreateIndex
CREATE INDEX "Request_clientId_idx" ON "Request"("clientId");

-- CreateIndex
CREATE INDEX "LineItem_quoteId_idx" ON "LineItem"("quoteId");

-- CreateIndex
CREATE INDEX "LineItem_jobId_idx" ON "LineItem"("jobId");

-- CreateIndex
CREATE INDEX "LineItem_invoiceId_idx" ON "LineItem"("invoiceId");

