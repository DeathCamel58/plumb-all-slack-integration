-- CreateTable
CREATE TABLE "AdValueAttribution" (
    "itemId" TEXT NOT NULL,
    "itemKind" TEXT NOT NULL,
    "quoteId" TEXT,
    "clientId" TEXT NOT NULL,
    "contactKind" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "workStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdValueAttribution_pkey" PRIMARY KEY ("itemId")
);

-- CreateIndex
CREATE INDEX "AdValueAttribution_contactId_idx" ON "AdValueAttribution"("contactId");

-- CreateIndex
CREATE INDEX "AdValueAttribution_quoteId_idx" ON "AdValueAttribution"("quoteId");
