/** Display only. Keep provider records intact for synchronization and auditing. */
export function supersededReviewedOffers(listings:any[]):Set<string>{
  const groups=new Map<string,any[]>();
  for(const listing of listings){
    const up=listing.userProductId??listing.rawData?.user_product_id;
    const family=listing.rawData?.family_id;
    if(!up||!family||listing.rawData?.sub_status?.includes('deleted'))continue;
    const key=JSON.stringify([listing.marketplaceAccountId,String(family),up]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key)!.push(listing);
  }
  const hidden=new Set<string>();
  for(const siblings of groups.values())for(const old of siblings){
    if(!['under_review','inactive','closed'].includes(old.status))continue;
    // Offer creation order does not determine which condition is usable.
    // A previously created paused/active offer also supersedes reviewed ones.
    if(siblings.some(current=>current.itemId!==old.itemId&&['active','paused'].includes(current.status)))hidden.add(old.id);
  }
  return hidden;
}
