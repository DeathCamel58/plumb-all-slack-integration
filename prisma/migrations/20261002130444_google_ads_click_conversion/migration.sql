-- CreateTable
CREATE TABLE "GoogleAdsClickConversion" (
    "gclid" TEXT NOT NULL,
    "transactionId" TEXT,
    "conversionDateTime" TEXT NOT NULL,
    "callStartTime" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "requestId" TEXT,
    "restatedValue" DECIMAL(12,2),
    "restatedCalls" JSONB,
    "restatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleAdsClickConversion_pkey" PRIMARY KEY ("gclid")
);
