const {createHash}=require('node:crypto');
const {Prisma}=require('@prisma/client');
function signature(order){return createHash('sha256').update(JSON.stringify({status:order.status,currency:order.currency,shipmentId:order.shipmentId,packId:order.packId,rows:(order.rows??[]).map(row=>[row.itemIndex,row.itemId,row.variationId,row.quantity,row.unitPrice,row.sku])})).digest('hex');}
function legacyScope(records,job,account){
 const stats=job.after.accounts?.find(row=>row.account===account);if(!stats)return null;
 const scope=records.filter(record=>record.payload.status==='paid'&&((record.payload.rows??[]).some(row=>row.sellerShipping===null||row.fiscalCost===null)||record.payload.financialEnrichedAt>=job.after.startedAt)).sort((a,b)=>b.payload.orderDate.localeCompare(a.payload.orderDate));
 if(scope.length!==stats.total)throw Error('O escopo anterior não pôde ser reconstruído com segurança para '+account+'.');
 const errors=new Set((job.after.issues??[]).filter(issue=>issue.account===account).map(issue=>issue.orderId));
 const reviewed=stats.failed?[]:scope.slice(0,stats.processed).filter(record=>!errors.has(record.payload.orderId));
 return {scope,reviewed,stats};
}
async function restoreCheckpoints(prisma,store,account,records,scopeId,chain){
 const key='v1|'+account.sellerId+'|'+scopeId;
 let scope=await store.get(account.id,'ORDER_ENRICHMENT_SCOPE',key);
 if(!scope){
  const legacy=chain.filter(job=>!job.after?.scopeId).reverse().map(job=>({job,plan:legacyScope(records,job,account.businessKey)})).filter(value=>value.plan);
  const ordered=legacy[0]?.plan.scope??records.filter(record=>record.payload.status==='paid'&&(record.payload.rows??[]).some(row=>row.sellerShipping===null||row.fiscalCost===null)).sort((a,b)=>b.payload.orderDate.localeCompare(a.payload.orderDate));
  const done=new Map();for(const {job,plan} of legacy)for(const record of plan.reviewed)done.set(record.payload.orderId,{orderId:record.payload.orderId,signature:signature(record.payload),complete:true,checkedAt:job.after.finishedAt??job.after.startedAt,legacyReviewed:true});
  const entries=[...done.values()],now=new Date();
  for(let i=0;i<entries.length;i+=250){const values=entries.slice(i,i+250).map(entry=>Prisma.sql`(${require('crypto').randomUUID()},${account.id},'ORDER_ENRICHMENT_CHECK',${'v1|'+account.sellerId+'|'+entry.orderId},${JSON.stringify(entry)}::jsonb,${now},${now})`);await prisma.$executeRaw(Prisma.sql`INSERT INTO "IntegrationSnapshot" ("id","marketplaceAccountId","category","key","payload","fetchedAt","updatedAt") VALUES ${Prisma.join(values)} ON CONFLICT ("marketplaceAccountId","category","key") DO NOTHING`);}
  const baseline=legacy.reduce((sum,{plan})=>({updated:sum.updated+(plan.stats.updated??0),shippingFilled:sum.shippingFilled+(plan.stats.shippingFilled??0),fiscalFilled:sum.fiscalFilled+(plan.stats.fiscalFilled??0)}),{updated:0,shippingFilled:0,fiscalFilled:0});
  scope=await store.put(account.id,'ORDER_ENRICHMENT_SCOPE',key,{orderIds:ordered.map(record=>record.payload.orderId),baseline,createdAt:now.toISOString()});
 }
 const checkpoints=await prisma.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'ORDER_ENRICHMENT_CHECK'},select:{payload:true}});
 const checked=new Map(checkpoints.map(record=>[record.payload.orderId,record.payload]));
 const byId=new Map(records.map(record=>[record.payload.orderId,record]));
 const scoped=scope.payload.orderIds.map(id=>byId.get(id)).filter(Boolean);
 const done=scoped.filter(record=>{const checkpoint=checked.get(record.payload.orderId);return checkpoint?.complete&&checkpoint.signature===signature(record.payload);});
 const completed=new Set(done.map(record=>record.payload.orderId));
 const baseline={...(scope.payload.baseline??{updated:0,shippingFilled:0,fiscalFilled:0})};
 for(const record of scoped){const checkpoint=checked.get(record.payload.orderId);if(checkpoint&&!checkpoint.legacyReviewed){baseline.updated+=checkpoint.updated??0;baseline.shippingFilled+=checkpoint.shippingFilled??0;baseline.fiscalFilled+=checkpoint.fiscalFilled??0;}}
 return {scope:scoped,targets:scoped.filter(record=>!completed.has(record.payload.orderId)),processed:done.length,baseline,checked};
}
module.exports={signature,legacyScope,restoreCheckpoints};
