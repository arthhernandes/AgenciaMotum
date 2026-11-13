import { sellerSku } from '../mercadolivre/synchronization/seller-sku';

export function listingSkuState(listing: any, catalogSkus: Set<string>) {
  const skus: Array<string | null | undefined> = listing.variants?.length
    ? listing.variants.map((variant: any) => sellerSku(variant.rawData) || variant.sku)
    : [sellerSku(listing.rawData)];
  return {
    missingSkuCount: skus.filter(sku => sku && !catalogSkus.has(sku)).length,
    absentSkuCount: skus.filter(sku => !sku).length,
    foundSkuCount: skus.filter(sku => sku && catalogSkus.has(sku)).length
  };
}
