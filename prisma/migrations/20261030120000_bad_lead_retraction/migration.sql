-- AlterTable
ALTER TABLE "GoogleAdsClickConversion" ADD COLUMN     "retractRequestedAt" TIMESTAMP(3),
ADD COLUMN     "retractedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "GoogleAdsAssetCallValue" ADD COLUMN     "retractRequestedAt" TIMESTAMP(3),
ADD COLUMN     "retractedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GoogleAdsClickConversion_transactionId_idx" ON "GoogleAdsClickConversion"("transactionId");
