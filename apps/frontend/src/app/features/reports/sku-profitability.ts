/** Monetary averages are weighted by units with a confirmed value for that field. */
import { announcementKey } from '../map/announcement-key';
export const skuAverageFields = ['revenue','commission','buyerShippingCredit','sellerShipping','fiscalCost','advertisingCost','invoiceTaxes','operatingCost','profitBeforeTaxes','netProfit'] as const;
type Field=typeof skuAverageFields[number];
export function groupSkuProfitability(rows: any[],byListing=false):any[] {
  const groups=new Map<string,any>(),seen=new Set<string>();
  for(const row of rows){
    const identity=String(row.orderId)+':'+row.itemIndex;
    if(seen.has(identity))continue;seen.add(identity);
    const rawSku=typeof row.sku==='string'?row.sku.trim().toUpperCase():'';
    const confirmedParent=typeof row.parentSku==='string'?row.parentSku.trim().toUpperCase():'';
    // Numeric variation SKUs use the parent prefix (5484.01 -> 5484).
    // Preserve other codes unless an explicit parent is provided.
    const sku=confirmedParent||(/^\d+\.\d+$/.test(rawSku)?rawSku.split('.')[0]:rawSku);
    const listingKey=announcementKey({marketplaceAccountId:row.parentListingAccountId??'',itemId:row.itemId??identity,rawData:{family_id:row.parentListingId&&row.parentListingId!==row.itemId?row.parentListingId:undefined}});
    const key=byListing?'listing:'+listingKey:sku?'sku:'+sku:'item:'+String(row.itemId??identity);
    let group=groups.get(key);
    if(!group){group={key,sku:sku||null,linkedListingCount:row.parentLinkedListingCount??null,parentConfirmed:!!row.parentListingId,title:byListing?(row.parentListingId?row.parentListingTitle||row.title||'':'Anúncio histórico sem família confirmada'):row.parentTitle||'',members:[],itemIds:new Set<string>(),orders:new Set<string>(),quantity:0,completeQuantity:0,completeRevenueCents:0,netProfitCents:0,revenueCents:0,revenueQuantity:0,fields:Object.fromEntries(skuAverageFields.map(field=>[field,{cents:0,quantity:0}]))};groups.set(key,group);}
    if(!byListing)group.members.push(row);
    if(row.itemId)group.itemIds.add(row.itemId);
    if(!group.title&&row.parentTitle)group.title=row.parentTitle;
    group.orders.add(String(row.orderId));
    const q=row.quantity;if(!Number.isSafeInteger(q)||q<=0)continue;
    group.quantity+=q;
    for(const field of skuAverageFields){
      // The order report permits blank manual inputs; averages include confirmed amounts only.
      const value=row[field];
      if(typeof value!=='number'||!Number.isFinite(value)||(field==='advertisingCost'&&row.advertisingPending))continue;
      const amount=Math.round((value+Number.EPSILON)*100);
      group.fields[field].cents+=amount;group.fields[field].quantity+=q;
    }
    if(typeof row.revenue==='number'&&Number.isFinite(row.revenue)){group.revenueCents+=Math.round((row.revenue+Number.EPSILON)*100);group.revenueQuantity+=q;}
    if(typeof row.netProfit==='number'&&Number.isFinite(row.netProfit)&&typeof row.revenue==='number'&&Number.isFinite(row.revenue)){
      group.completeQuantity+=q;group.completeRevenueCents+=Math.round((row.revenue+Number.EPSILON)*100);group.netProfitCents+=Math.round((row.netProfit+Number.EPSILON)*100);
    }
  }
  return [...groups.values()].map(group=>({
    key:group.key,sku:group.sku,linkedListingCount:group.linkedListingCount,title:group.title,parentConfirmed:group.parentConfirmed,orders:group.orders.size,quantity:group.quantity,completeQuantity:group.completeQuantity,
    itemIds:[...group.itemIds],listingRows:byListing?[]:groupSkuProfitability(group.members,true),
    revenue:group.revenueQuantity?group.revenueCents/100:null,
    projectedAdvertising:group.fields.revenue.quantity?Math.round(group.fields.revenue.cents/group.fields.revenue.quantity*0.03)/100:null,
    netProfit:group.completeQuantity?group.netProfitCents/100:null,
    netMargin:group.completeQuantity&&group.completeRevenueCents>0?Math.round(group.netProfitCents/group.completeRevenueCents*10000)/100:null,
    averages:Object.fromEntries(skuAverageFields.map(field=>[field,group.fields[field].quantity?group.fields[field].cents/group.fields[field].quantity/100:null])) as Record<Field,number|null>,
    coverage:Object.fromEntries(skuAverageFields.map(field=>[field,group.fields[field].quantity])) as Record<Field,number>
  })).sort((a,b)=>b.quantity-a.quantity||String(a.sku??a.key).localeCompare(String(b.sku??b.key),'pt-BR',{numeric:true}));
}
