-- Preserve provider identities: an Olist token/product ID is never a Bling ID.
ALTER TYPE "Marketplace" ADD VALUE 'BLING';
ALTER TYPE "SyncSource" ADD VALUE 'BLING';
ALTER TYPE "AuditIssueType" ADD VALUE 'BLING_SKU_WITHOUT_VARIATION';

ALTER TABLE "MarketplaceAccount" ALTER COLUMN "businessKey" DROP DEFAULT;
UPDATE "MarketplaceAccount" SET active = false
WHERE marketplace = 'OLIST' OR "businessKey" IN ('outlet4u', 'mottum');

ALTER TABLE "Product" RENAME COLUMN "olistProductId" TO "blingProductId";
ALTER TABLE "Product" RENAME COLUMN "olistAccountId" TO "blingAccountId";
ALTER TABLE "ProductVariant" RENAME COLUMN "olistVariantId" TO "blingVariantId";
ALTER TABLE "ProductVariant" RENAME COLUMN "olistAccountId" TO "blingAccountId";
ALTER INDEX "Product_olistAccountId_idx" RENAME TO "Product_blingAccountId_idx";
ALTER INDEX "ProductVariant_olistAccountId_idx" RENAME TO "ProductVariant_blingAccountId_idx";
ALTER INDEX "Product_olistAccountId_olistProductId_key" RENAME TO "Product_blingAccountId_blingProductId_key";
ALTER INDEX "ProductVariant_olistAccountId_sku_key" RENAME TO "ProductVariant_blingAccountId_sku_key";
ALTER INDEX "ProductVariant_olistAccountId_olistVariantId_key" RENAME TO "ProductVariant_blingAccountId_blingVariantId_key";

-- Supabase Data API must not expose passwords, tokens or application tables.
-- The backend connects through a trusted PostgreSQL role, never an anon key.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['User','Product','ProductVariant','MarketplaceAccount','MarketplaceListing','MarketplaceListingVariant','ListingProductLink','AuditIssue','SyncExecution','AuditLog','IntegrationSnapshot','NcmEntry']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', table_name);
    END IF;
  END LOOP;
END $$;
