// Read the real checkpoints without contacting Mercado Livre or writing anything.
require('dotenv').config({quiet:true});const{PrismaClient}=require('@prisma/client');
const {advertisingImportFrom,orderImportRanges}=require('../apps/backend/dist/src/reports/incremental-ranges');
const {missingDailyRanges,shiftDay}=require('../apps/backend/dist/src/reports/daily-metrics');
const p=new PrismaClient(),today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
(async()=>{
 for(const account of await p.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true}})){
  const records=await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:{in:['ORDER_HISTORY_DAY','PRODUCT_ADS_DAILY','VISITS_DAILY']}},select:{category:true,payload:true}});
  const days=records.filter(r=>r.category==='ORDER_HISTORY_DAY'&&r.payload.complete).map(r=>r.payload.date),ads=records.filter(r=>r.category==='PRODUCT_ADS_DAILY').map(r=>r.payload),visits=records.find(r=>r.category==='VISITS_DAILY');
  const from=String(Number(today.slice(0,4))-1)+today.slice(4),visitsFrom=String(Number(today.slice(0,4))-2)+today.slice(4);
  console.log(JSON.stringify({account:account.businessKey,orders:orderImportRanges(from,today,days),advertising:{from:advertisingImportFrom(ads,shiftDay(today,-89),today),to:today},sampleVisits:visits?missingDailyRanges(visits.payload,visitsFrom,today,'visits'):null,providerCalls:0}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
