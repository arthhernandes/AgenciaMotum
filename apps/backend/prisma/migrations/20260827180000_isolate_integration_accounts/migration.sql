ALTER TABLE "MarketplaceAccount" ADD COLUMN "businessKey" TEXT NOT NULL DEFAULT 'outlet4u';
CREATE INDEX "MarketplaceAccount_businessKey_idx" ON "MarketplaceAccount"("businessKey");

UPDATE "MarketplaceAccount"
SET "businessKey" = 'outlet4u'
WHERE marketplace = 'OLIST' AND "sellerId" IN ('outlet4u', 'OLIST_LOCAL');

INSERT INTO "MarketplaceAccount" (id, marketplace, name, "sellerId", nickname, active, "businessKey", "createdAt", "updatedAt")
VALUES ('olist-ts-comercio', 'OLIST', 'Olist', 'ts_comercio', 'Tiny/Olist - Mottum', true, 'mottum', NOW(), NOW())
ON CONFLICT (marketplace, "sellerId") DO UPDATE SET "businessKey" = 'mottum', nickname = 'Tiny/Olist - Mottum';

INSERT INTO "MarketplaceAccount" (id, marketplace, name, "sellerId", nickname, active, "businessKey", "createdAt", "updatedAt")
VALUES ('meli-mottum-oauth', 'MERCADO_LIVRE', 'Mercado Livre', 'PENDING_MOTTUM_OAUTH', 'Mercado Livre - Mottum', true, 'mottum', NOW(), NOW())
ON CONFLICT (marketplace, "sellerId") DO UPDATE SET "businessKey" = 'mottum', nickname = 'Mercado Livre - Mottum';

UPDATE "MarketplaceAccount"
SET "businessKey" = 'outlet4u'
WHERE marketplace = 'MERCADO_LIVRE' AND id <> 'meli-mottum-oauth';
