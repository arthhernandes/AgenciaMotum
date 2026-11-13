-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('MERCADO_LIVRE');
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CONSULTANT', 'VIEWER');
CREATE TYPE "ListingMatchType" AS ENUM ('SKU', 'USER_PRODUCT', 'CATALOG_PRODUCT', 'MANUAL', 'AUTO');
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');
CREATE TYPE "AuditIssueType" AS ENUM ('NO_LISTING', 'PAUSED_WITH_STOCK', 'STOCK_DIVERGENCE', 'ML_SKU_NOT_FOUND', 'OLIST_SKU_WITHOUT_VARIATION', 'UNLINKED_LISTING', 'DUPLICATE_LISTING', 'CLOSED_WITH_STOCK', 'PRODUCT_WITHOUT_MATCH', 'MISSING_VARIATION', 'EXTRA_VARIATION');
CREATE TYPE "SyncType" AS ENUM ('FULL_SYNC', 'INCREMENTAL_SYNC', 'MANUAL_SYNC');
CREATE TYPE "SyncSource" AS ENUM ('MERCADO_LIVRE', 'OLIST', 'AUDIT', 'MATCHING');
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "User" ("id" TEXT NOT NULL, "email" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "name" TEXT NOT NULL, "role" "UserRole" NOT NULL DEFAULT 'VIEWER', "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "User_pkey" PRIMARY KEY ("id"));
CREATE TABLE "Product" ("id" TEXT NOT NULL, "olistProductId" TEXT NOT NULL, "sku" TEXT NOT NULL, "title" TEXT NOT NULL, "brand" TEXT, "category" TEXT, "internalStatus" TEXT NOT NULL DEFAULT 'REVIEW', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Product_pkey" PRIMARY KEY ("id"));
CREATE TABLE "ProductVariant" ("id" TEXT NOT NULL, "productId" TEXT NOT NULL, "olistVariantId" TEXT, "sku" TEXT NOT NULL, "color" TEXT, "size" TEXT, "stock" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id"));
CREATE TABLE "MarketplaceAccount" ("id" TEXT NOT NULL, "marketplace" "Marketplace" NOT NULL, "name" TEXT NOT NULL, "sellerId" TEXT NOT NULL, "nickname" TEXT, "accessToken" TEXT, "refreshToken" TEXT, "tokenExpiresAt" TIMESTAMP(3), "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MarketplaceAccount_pkey" PRIMARY KEY ("id"));
CREATE TABLE "MarketplaceListing" ("id" TEXT NOT NULL, "marketplaceAccountId" TEXT NOT NULL, "itemId" TEXT NOT NULL, "userProductId" TEXT, "title" TEXT NOT NULL, "status" TEXT NOT NULL, "listingTypeId" TEXT, "catalogProductId" TEXT, "price" DECIMAL(14,2) NOT NULL, "availableQuantity" INTEGER NOT NULL DEFAULT 0, "soldQuantity" INTEGER NOT NULL DEFAULT 0, "permalink" TEXT, "rawData" JSONB, "lastSyncedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id"));
CREATE TABLE "MarketplaceListingVariant" ("id" TEXT NOT NULL, "listingId" TEXT NOT NULL, "variationId" TEXT NOT NULL, "userProductId" TEXT, "sku" TEXT, "availableQuantity" INTEGER NOT NULL DEFAULT 0, "soldQuantity" INTEGER NOT NULL DEFAULT 0, "attributes" JSONB, "rawData" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MarketplaceListingVariant_pkey" PRIMARY KEY ("id"));
CREATE TABLE "ListingProductLink" ("id" TEXT NOT NULL, "productId" TEXT, "productVariantId" TEXT, "listingId" TEXT NOT NULL, "listingVariantId" TEXT, "matchType" "ListingMatchType" NOT NULL, "confidence" INTEGER NOT NULL, "manuallyConfirmed" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ListingProductLink_pkey" PRIMARY KEY ("id"));
CREATE TABLE "AuditIssue" ("id" TEXT NOT NULL, "type" "AuditIssueType" NOT NULL, "severity" "AuditSeverity" NOT NULL, "productId" TEXT, "productVariantId" TEXT, "listingId" TEXT, "listingVariantId" TEXT, "marketplaceAccountId" TEXT, "title" TEXT NOT NULL, "description" TEXT NOT NULL, "metadata" JSONB, "resolved" BOOLEAN NOT NULL DEFAULT false, "resolvedAt" TIMESTAMP(3), "resolvedBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AuditIssue_pkey" PRIMARY KEY ("id"));
CREATE TABLE "SyncExecution" ("id" TEXT NOT NULL, "type" "SyncType" NOT NULL, "source" "SyncSource" NOT NULL, "marketplaceAccountId" TEXT, "status" "SyncStatus" NOT NULL DEFAULT 'PENDING', "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3), "itemsProcessed" INTEGER NOT NULL DEFAULT 0, "itemsCreated" INTEGER NOT NULL DEFAULT 0, "itemsUpdated" INTEGER NOT NULL DEFAULT 0, "errors" INTEGER NOT NULL DEFAULT 0, "errorDetails" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SyncExecution_pkey" PRIMARY KEY ("id"));
CREATE TABLE "AuditLog" ("id" TEXT NOT NULL, "userId" TEXT, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "before" JSONB, "after" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"));

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Product_olistProductId_key" ON "Product"("olistProductId");
CREATE INDEX "Product_sku_idx" ON "Product"("sku");
CREATE INDEX "Product_brand_idx" ON "Product"("brand");
CREATE UNIQUE INDEX "ProductVariant_olistVariantId_key" ON "ProductVariant"("olistVariantId");
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");
CREATE INDEX "ProductVariant_sku_idx" ON "ProductVariant"("sku");
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");
CREATE INDEX "MarketplaceAccount_sellerId_idx" ON "MarketplaceAccount"("sellerId");
CREATE UNIQUE INDEX "MarketplaceAccount_marketplace_sellerId_key" ON "MarketplaceAccount"("marketplace", "sellerId");
CREATE INDEX "MarketplaceListing_itemId_idx" ON "MarketplaceListing"("itemId");
CREATE INDEX "MarketplaceListing_userProductId_idx" ON "MarketplaceListing"("userProductId");
CREATE INDEX "MarketplaceListing_status_idx" ON "MarketplaceListing"("status");
CREATE INDEX "MarketplaceListing_marketplaceAccountId_idx" ON "MarketplaceListing"("marketplaceAccountId");
CREATE UNIQUE INDEX "MarketplaceListing_marketplaceAccountId_itemId_key" ON "MarketplaceListing"("marketplaceAccountId", "itemId");
CREATE INDEX "MarketplaceListingVariant_sku_idx" ON "MarketplaceListingVariant"("sku");
CREATE INDEX "MarketplaceListingVariant_userProductId_idx" ON "MarketplaceListingVariant"("userProductId");
CREATE INDEX "MarketplaceListingVariant_listingId_idx" ON "MarketplaceListingVariant"("listingId");
CREATE UNIQUE INDEX "MarketplaceListingVariant_listingId_variationId_key" ON "MarketplaceListingVariant"("listingId", "variationId");
CREATE INDEX "ListingProductLink_productId_idx" ON "ListingProductLink"("productId");
CREATE INDEX "ListingProductLink_productVariantId_idx" ON "ListingProductLink"("productVariantId");
CREATE INDEX "ListingProductLink_listingId_idx" ON "ListingProductLink"("listingId");
CREATE INDEX "ListingProductLink_listingVariantId_idx" ON "ListingProductLink"("listingVariantId");
CREATE UNIQUE INDEX "ListingProductLink_listingId_listingVariantId_productVarian_key" ON "ListingProductLink"("listingId", "listingVariantId", "productVariantId");
CREATE INDEX "AuditIssue_type_idx" ON "AuditIssue"("type");
CREATE INDEX "AuditIssue_severity_idx" ON "AuditIssue"("severity");
CREATE INDEX "AuditIssue_resolved_idx" ON "AuditIssue"("resolved");
CREATE INDEX "SyncExecution_source_idx" ON "SyncExecution"("source");
CREATE INDEX "SyncExecution_status_idx" ON "SyncExecution"("status");
CREATE INDEX "SyncExecution_marketplaceAccountId_idx" ON "SyncExecution"("marketplaceAccountId");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceListingVariant" ADD CONSTRAINT "MarketplaceListingVariant_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingProductLink" ADD CONSTRAINT "ListingProductLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ListingProductLink" ADD CONSTRAINT "ListingProductLink_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ListingProductLink" ADD CONSTRAINT "ListingProductLink_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingProductLink" ADD CONSTRAINT "ListingProductLink_listingVariantId_fkey" FOREIGN KEY ("listingVariantId") REFERENCES "MarketplaceListingVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_listingVariantId_fkey" FOREIGN KEY ("listingVariantId") REFERENCES "MarketplaceListingVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SyncExecution" ADD CONSTRAINT "SyncExecution_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
