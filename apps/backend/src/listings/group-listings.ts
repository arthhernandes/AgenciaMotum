import { catalogSearch, matchesCatalogSku } from '../common/catalog-search';
import { supersededReviewedOffers } from './superseded-reviewed-offers';
import { listingWriteBlock, FINALIZED_MESSAGE } from './listing-write-block';
export function groupListings(listings: any[], query: { search?: string; status?: string; linked?: string; skuMatch?: string; full?:'true'|'false' } = {}) {
  const families = new Map<string, any[]>();
  const search=query.search?catalogSearch(query.search):null;
  const familyTerm=/^(?:(?:fam[ií]lia|family)\s*[:#]?\s*)?(\d+)$/i.exec(query.search?.trim()??'')?.[1];
  const familySearch=!!familyTerm&&listings.some(listing=>String(listing.rawData?.family_id??'')===familyTerm);
  const hidden=supersededReviewedOffers(listings);
  const referenceByFamily=new Map<string,any>();
  const familyKey=(listing:any)=>listing.marketplaceAccountId+':'+(listing.rawData?.family_id?'family:'+listing.rawData.family_id:'item:'+listing.itemId);
  const date=(row:any)=>{const value=Date.parse(row.rawData?.date_created??'');return Number.isFinite(value)?value:Number.MAX_SAFE_INTEGER;};
  for(const listing of listings){if(hidden.has(listing.id)||listing.rawData?.sub_status?.includes('deleted'))continue;const key=familyKey(listing),previous=referenceByFamily.get(key);if(!previous||date(listing)<date(previous)||date(listing)===date(previous)&&String(listing.itemId).localeCompare(String(previous.itemId),'en',{numeric:true})<0)referenceByFamily.set(key,listing);}
  for (const listing of listings) {
    if(hidden.has(listing.id))continue;
    // Mercado Livre also returns deleted moderated listings as inactive.
    if(listing.rawData?.sub_status?.includes('deleted'))continue;
    if(search?.kind==='sku'&&!familySearch){
      const skus=[listing.rawData?.seller_custom_field,...(listing.rawData?.attributes||[]).filter((attribute:any)=>attribute.id==='SELLER_SKU').map((attribute:any)=>attribute.value_name),...(listing.variants||[]).map((variant:any)=>variant.sku)];
      if(!skus.some(sku=>matchesCatalogSku(sku,search.term)))continue;
    }
    const family = listing.rawData?.family_id;
    const key = `${listing.marketplaceAccountId}:${family ? `family:${family}` : `item:${listing.itemId}`}`;
    if (!families.has(key)) families.set(key, []);
    families.get(key)!.push(listing);
  }
  return Array.from(families, ([id, children]) => {
    const first = children[0];
    const interactionBlocked=children.every(child=>!!listingWriteBlock(child));
    const blockedCount=children.filter(child=>!!listingWriteBlock(child)).length;
    const allFinalized=children.every(child=>!!listingWriteBlock(child));
    const parentSkus=[...new Set<string>(children.flatMap(child=>child.catalogParentSkus??[]))].sort();
    const referenceMlb=referenceByFamily.get(id)?.itemId??first.itemId;
    const fullCount=children.filter(child=>child.rawData?.shipping?.logistic_type==='fulfillment').length;
    const variants = children.flatMap(child => child.variants?.length ? child.variants.map((v: any) => ({ ...v, itemId: child.itemId, status: listingWriteBlock(child)?'closed':child.status, price: child.price, isFull:child.rawData?.shipping?.logistic_type==='fulfillment', listingData: child })) : [{
      id: child.id, variationId: child.itemId, itemId: child.itemId,
      sku: child.rawData?.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name || child.rawData?.seller_custom_field,
      availableQuantity: child.availableQuantity, soldQuantity: child.soldQuantity,
      status: listingWriteBlock(child)?'closed':child.status, price: child.price, isFull:child.rawData?.shipping?.logistic_type==='fulfillment', listingData: child,
      attributes: { attribute_combinations: child.rawData?.attributes || [] }
    }]);
    const prices = children.map(child => Number(child.price));
    const foundSkuCount=children.reduce((sum,child)=>sum+(child.foundSkuCount??0),0);
    const missingSkuCount=children.reduce((sum,child)=>sum+(child.missingSkuCount??0),0);
    const absentSkuCount=children.reduce((sum,child)=>sum+(child.absentSkuCount??0),0);
    const skuStatus=foundSkuCount>0?(missingSkuCount+absentSkuCount>0?'partial':'found'):(missingSkuCount>0?'missing':'no_sku');
    return { ...first, id, title: first.rawData?.family_name || first.title,
      parentSkus,referenceMlb,
      interactionBlocked,blockedCount,interactionBlockReason:interactionBlocked?FINALIZED_MESSAGE:undefined,finalized:allFinalized,
      hasFull:fullCount>0,isFull:fullCount===children.length,fullCount,fullTotal:children.length,
      foundSkuCount,missingSkuCount,absentSkuCount,skuStatus,
      familyId: first.rawData?.family_id ? String(first.rawData.family_id) : null,
      itemId: children.length > 1 ? `${children.length} MLBs` : first.itemId,
      status: allFinalized?'closed':children.every(child => child.status === first.status) ? first.status : 'mixed',
      price: Math.min(...prices), maxPrice: Math.max(...prices),
      availableQuantity: children.reduce((sum, child) => sum + child.availableQuantity, 0),
      soldQuantity: children.reduce((sum, child) => sum + child.soldQuantity, 0),
      variants, children, links: children.flatMap(child => child.links || []) };
  }).filter(group=>!query.full||(query.full==='true'?group.hasFull:!group.hasFull)).filter(group => group.children.some((child: any) => {
    const term = query.search?.toLowerCase();
    const search=term?catalogSearch(term):null;
    const skus=[child.rawData?.seller_custom_field,...(child.rawData?.attributes||[]).filter((a:any)=>a.id==='SELLER_SKU').map((a:any)=>a.value_name),...(child.variants||[]).map((v:any)=>v.sku)];
    const matchesSearch = familySearch?String(child.rawData?.family_id??'')===familyTerm:!search || (search.kind==='sku'?skus.some(sku=>matchesCatalogSku(sku,search.term)):search.kind==='mlb'?String(child.itemId).toUpperCase()===search.term:[child.title,child.rawData?.family_name].some(value=>String(value||'').toLowerCase().includes(search.term)));
    const matchesSku = !query.skuMatch || (query.skuMatch === 'missing' ? child.missingSkuCount > 0 : query.skuMatch === 'no_sku' ? child.absentSkuCount > 0 : group.skuStatus===query.skuMatch);
    return matchesSearch && matchesSku && (!query.status || (query.status==='closed'&&group.finalized)||child.status === query.status&&!group.finalized) && (!query.linked || (query.linked === 'true' ? child.links?.length > 0 : !child.links?.length));
  }));
}
