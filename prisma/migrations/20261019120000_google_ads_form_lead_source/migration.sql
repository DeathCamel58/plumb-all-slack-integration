-- AlterTable
ALTER TABLE "GoogleAdsLeadFormLead" ADD COLUMN     "conversionAction" TEXT,
ADD COLUMN     "gbraid" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'google_lead_form',
ADD COLUMN     "wbraid" TEXT,
ALTER COLUMN "gclid" DROP NOT NULL;
