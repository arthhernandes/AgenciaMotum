ALTER TABLE "Product" ADD COLUMN "olistAccountId" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN "olistAccountId" TEXT;

UPDATE "Product"
SET "olistAccountId" = (
  SELECT id FROM "MarketplaceAccount"
  WHERE marketplace = 'OLIST' AND "sellerId" = 'outlet4u'
  ORDER BY "updatedAt" DESC LIMIT 1
);

UPDATE "ProductVariant" pv
SET "olistAccountId" = p."olistAccountId"
FROM "Product" p
WHERE p.id = pv."productId";

DROP INDEX IF EXISTS "Product_olistProductId_key";
DROP INDEX IF EXISTS "ProductVariant_olistVariantId_key";
DROP INDEX IF EXISTS "ProductVariant_sku_key";

CREATE INDEX "Product_olistAccountId_idx" ON "Product"("olistAccountId");
CREATE INDEX "ProductVariant_olistAccountId_idx" ON "ProductVariant"("olistAccountId");
CREATE UNIQUE INDEX "Product_olistAccountId_olistProductId_key" ON "Product"("olistAccountId", "olistProductId");
CREATE UNIQUE INDEX "ProductVariant_olistAccountId_sku_key" ON "ProductVariant"("olistAccountId", "sku");
CREATE UNIQUE INDEX "ProductVariant_olistAccountId_olistVariantId_key" ON "ProductVariant"("olistAccountId", "olistVariantId");
