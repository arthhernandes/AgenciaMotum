require('dotenv').config({quiet:true});
const assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client');
const prisma=new PrismaClient();
async function main(){
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 const headers={Authorization:'Bearer '+login.accessToken,'Content-Type':'application/json'};
 const account=await prisma.marketplaceAccount.findFirstOrThrow({where:{businessKey:'outlet4u',marketplace:'MERCADO_LIVRE',active:true}});
 const get=async(path,params)=>{const response=await fetch('http://localhost:3001/api/reports/profitability'+path+'?'+new URLSearchParams({marketplaceAccountId:account.id,...params}),{headers});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),period={dateFrom:today,dateTo:today};
 const first=await get('',{...period,offset:'0',limit:'1'}),second=await get('',{...period,offset:'0',limit:'1'});
 assert.equal(second.fromDatabase,true);assert.ok(second.rows.length);assert.deepEqual(second.rows,first.rows);
 const adsPeriod={dateFrom:'2026-10-01',dateTo:'2026-10-22',itemIds:'MLB6823247786'};
 const ads=await get('/advertising',adsPeriod),savedAds=await get('/advertising',{...adsPeriod,cachedOnly:'true'});
 assert.equal(savedAds.results[0].fromDatabase,true);assert.equal(savedAds.results[0].cost,ads.results[0].cost);assert.ok(ads.results[0].cost>=0);
 // Isolated, reversible input test: never overwrite a user's report period.
 const key='v1|'+account.sellerId+'|1901-01-01|1901-01-01';
 const where={marketplaceAccountId_category_key:{marketplaceAccountId:account.id,category:'PROFIT_INPUTS',key}};
 if(!await prisma.integrationSnapshot.findUnique({where})){
   try{
     const response=await fetch('http://localhost:3001/api/reports/profitability/inputs?marketplaceAccountId='+account.id,{method:'POST',headers,body:JSON.stringify({marketplaceAccountId:account.id,dateFrom:'1901-01-01',dateTo:'1901-01-01',taxRate:6.5,manualAdvertising:[{orderId:'1',itemIndex:0,advertisingCost:2.75}]})});assert.equal(response.status,201,await response.text());
     const input=await get('/inputs',{dateFrom:'1901-01-01',dateTo:'1901-01-01'});assert.equal(input.taxRate,6.5);assert.equal(input.manualAdvertising[0].advertisingCost,2.75);
   }finally{const testRecord=await prisma.integrationSnapshot.findUnique({where});if(testRecord)await prisma.integrationSnapshot.delete({where:{id:testRecord.id}});}
 }
 const persisted=await prisma.integrationSnapshot.groupBy({by:['category'],_count:true});
 console.log(JSON.stringify({ordersRestoredFromDatabase:true,advertisingRestoredFromDatabase:true,taxAndManualInputsSaved:true,realAdCost:ads.results[0].cost,persisted}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
