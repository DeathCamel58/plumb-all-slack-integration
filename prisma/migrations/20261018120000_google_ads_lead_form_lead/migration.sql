-- CreateTable
CREATE TABLE "GoogleAdsLeadFormLead" (
    "leadId" TEXT NOT NULL,
    "gclid" TEXT NOT NULL,
    "phoneHash" TEXT,
    "emailHash" TEXT,
    "conversionDateTime" TEXT NOT NULL,
    "value" DECIMAL(12,2),
    "claimedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "requestId" TEXT,
    "restatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleAdsLeadFormLead_pkey" PRIMARY KEY ("leadId")
);

-- CreateIndex
CREATE INDEX "GoogleAdsLeadFormLead_phoneHash_idx" ON "GoogleAdsLeadFormLead"("phoneHash");

-- CreateIndex
CREATE INDEX "GoogleAdsLeadFormLead_emailHash_idx" ON "GoogleAdsLeadFormLead"("emailHash");
