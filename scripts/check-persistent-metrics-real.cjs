// Read-only check against the real database. Provider access deliberately fails.
require('dotenv').config({quiet:true});
const assert=require('node:assert/strict');const{PrismaClient}=require('@prisma/client');
const {ListingVisitsService}=require('../apps/backend/dist/src/listings/listing-visits.service');
const {ProfitabilityService}=require('../apps/backend/dist/src/reports/profitability.service');
const {dailyTotal}=require('../apps/backend/dist/src/reports/daily-metrics');
const p=new PrismaClient(),dateFrom='2026-10-05',dateTo='2026-10-13';let providerCalls=0;
const unavailable=()=>{providerCalls++;throw Error('Provider access forbidden in persistence check');};
async function main(){
 for(const account of await p.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true}})){
  const records=await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:{in:['VISITS_DAILY','PRODUCT_ADS_DAILY']}}});
  const local=new Set((await p.marketplaceListing.findMany({where:{marketplaceAccountId:account.id},select:{itemId:true}})).map(r=>r.itemId));
  const visits=records.find(r=>r.category==='VISITS_DAILY'&&local.has(r.payload.itemId)&&dailyTotal(r.payload,r.payload.itemId,dateFrom,dateTo,'visits')>0);
  const ads=records.find(r=>r.category==='PRODUCT_ADS_DAILY'&&dailyTotal(r.payload,r.payload.itemId,dateFrom,dateTo,'BRL_CENTS')>0);
  assert.ok(visits,'No nonzero imported visit sample for '+account.businessKey);assert.ok(ads,'No nonzero imported ad sample for '+account.businessKey);
  for(let instance=0;instance<2;instance++){
   const service=new ListingVisitsService(p,{getItemVisits:unavailable},{getValidAccessToken:unavailable});
   const result=await service.find(account.id,[visits.payload.itemId],dateFrom,dateTo);
   assert.equal(result.items[0].visits,dailyTotal(visits.payload,visits.payload.itemId,dateFrom,dateTo,'visits'));
   const report=new ProfitabilityService(p,{getValidAccessToken:unavailable});
   const costs=await report.advertising({marketplaceAccountId:account.id,dateFrom,dateTo,itemIds:ads.payload.itemId,cachedOnly:true,refresh:false});
   assert.equal(costs.results[0]?.cost,dailyTotal(ads.payload,ads.payload.itemId,dateFrom,dateTo,'BRL_CENTS')/100);assert.equal(costs.results[0].fromDatabase,true);
  }
  console.log(JSON.stringify({account:account.businessKey,recreatedServices:2,dateFrom,dateTo,visitsFromDatabase:true,advertisingFromDatabase:true,providerCalls}));
 }
 assert.equal(providerCalls,0);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
