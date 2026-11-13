require('dotenv').config({quiet:true});const{PrismaClient}=require('@prisma/client');
const{dailyTotal}=require('../apps/backend/dist/src/reports/daily-metrics');const p=new PrismaClient();
async function main(){
 const job=await p.auditLog.findFirst({where:{action:'ADVERTISING_VISITS_IMPORT'},orderBy:{createdAt:'desc'}});
 if(!job)throw Error('Nenhuma importação de métricas encontrada.');const state=job.after;
 const result={jobId:job.id,status:state.status,startedAt:state.startedAt,readAt:new Date().toISOString(),accounts:state.accounts.map(a=>({account:a.account,stage:a.stage,ads:a.ads,visitsCompleted:a.visitItems,totalItems:a.totalItems,errors:a.errors})),requests:state.requests,intervalMs:state.intervalMs,throttled:state.throttled??0,issues:state.issues.slice(0,5)};
 if(process.argv.includes('--verify')){
  result.database=[];
  for(const account of await p.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true}})){
   const records=await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:{in:['VISITS_DAILY','PRODUCT_ADS_DAILY']}}});
   const visits=records.filter(r=>r.category==='VISITS_DAILY'),ads=records.filter(r=>r.category==='PRODUCT_ADS_DAILY');
   const full=visits.map(r=>dailyTotal(r.payload,r.payload.itemId,state.visitsFrom,state.to,'visits'));
   const costs=ads.map(r=>dailyTotal(r.payload,r.payload.itemId,state.adsFrom,state.to,'BRL_CENTS'));
   result.database.push({account:account.businessKey,visitsRecords:visits.length,visitsComplete:full.filter(v=>v!==null).length,visits:full.reduce((sum,v)=>sum+(v??0),0),visitsFrom:state.visitsFrom,to:state.to,adsRecords:ads.length,adsComplete:costs.filter(v=>v!==null).length,advertisingCost:costs.reduce((sum,v)=>sum+(v??0),0)/100,adsFrom:state.adsFrom,expiringRecords:records.filter(r=>r.expiresAt!==null).length});
  }
 }
 console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
