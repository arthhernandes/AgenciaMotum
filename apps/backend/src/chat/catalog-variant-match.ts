import { sellerSku } from '../mercadolivre/synchronization/seller-sku';
import { skuListingDimensions } from '../listing-links/sku-listing-dimensions';
import { colorKey, sameSize } from '../listing-links/sku-correspondence';

/** SKU identity tolerates provider color labels; explicit size conflicts do not. */
export function matchesCatalogVariant(row:{sku?:string;color:string|null;size:string|null},variant:any):boolean{
  const dimensions=skuListingDimensions(variant);
  const sku=sellerSku(variant)??variant.sku;
  if(row.sku&&sku===row.sku)return !dimensions.size||sameSize(dimensions.size,row.size);
  return !!row.color&&!!row.size&&colorKey(dimensions.color)===colorKey(row.color)&&sameSize(dimensions.size,row.size);
}
