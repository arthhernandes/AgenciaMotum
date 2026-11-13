CREATE TABLE "IntegrationSnapshot" (
  "id" TEXT NOT NULL,
  "marketplaceAccountId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationSnapshot_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IntegrationSnapshot_marketplaceAccountId_category_key_key" ON "IntegrationSnapshot"("marketplaceAccountId", "category", "key");
CREATE INDEX "IntegrationSnapshot_marketplaceAccountId_category_expiresAt_idx" ON "IntegrationSnapshot"("marketplaceAccountId", "category", "expiresAt");
