-- CreateTable
CREATE TABLE "GoogleAdsAssetCallValue" (
    "callId" TEXT NOT NULL,
    "gclid" TEXT NOT NULL,
    "conversionDateTime" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "requestId" TEXT,
    "restatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleAdsAssetCallValue_pkey" PRIMARY KEY ("callId")
);

-- CreateIndex
CREATE INDEX "GoogleAdsAssetCallValue_gclid_idx" ON "GoogleAdsAssetCallValue"("gclid");
