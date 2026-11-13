require('dotenv').config({quiet:true});const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
async function main(){let job=await p.auditLog.findFirstOrThrow({where:{action:'ORDER_HISTORY_ENRICHMENT'},orderBy:{createdAt:'desc'}});const chain=[];while(job){chain.push(job);job=job.after?.resumedFrom?await p.auditLog.findUnique({where:{id:job.after.resumedFrom}}):null;}
 for(const account of await p.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true}})){
  const records=await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'ORDER_HISTORY'},orderBy:{key:'asc'},select:{key:true,payload:true}}),done=new Set();
  for(const item of [...chain].reverse()){
   const stats=item.after.accounts?.find(row=>row.account===account.businessKey);if(!stats)continue;
   const scope=records.filter(record=>record.payload.status==='paid'&&((record.payload.rows??[]).some(row=>row.sellerShipping===null||row.fiscalCost===null)||record.payload.financialEnrichedAt>=item.after.startedAt)).sort((a,b)=>b.payload.orderDate.localeCompare(a.payload.orderDate));
   if(scope.length===stats.total)for(const record of scope.slice(0,stats.processed))done.add(record.payload.orderId);
   console.log(JSON.stringify({account:account.businessKey,job:item.id,expected:stats.total,reconstructed:scope.length,processed:stats.processed,reconstructable:scope.length===stats.total,uniqueReviewed:done.size}));
  }
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
