#!/usr/bin/env node
require('dotenv').config({quiet:true});
const {randomUUID}=require('node:crypto');
const {PrismaClient,Prisma}=require('@prisma/client');
const {HttpService}=require('@nestjs/axios');
const {ConfigService}=require('@nestjs/config');
const {MercadoLivreAuthService}=require('../apps/backend/dist/src/mercadolivre/auth/mercadolivre-auth.service');
const {FinanceApi}=require('../apps/backend/dist/src/reports/finance-api');
const {PersistentSnapshots}=require('../apps/backend/dist/src/reports/persistent-snapshots');
const {historyOrder}=require('../apps/backend/dist/src/reports/order-history');
const {cents}=require('../apps/backend/dist/src/reports/profitability-calculation');
const {orderImportRanges}=require('../apps/backend/dist/src/reports/incremental-ranges');
const prisma=new PrismaClient(),store=new PersistentSnapshots(prisma);
const nextDay=day=>new Date(Date.parse(day)+86400000).toISOString().slice(0,10);
const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
let job=null;const progress={status:'RUNNING',processId:process.pid,processed:0,pages:0,issues:[],accounts:[],current:null};
async function heartbeat(){if(job)await prisma.auditLog.update({where:{id:job.id},data:{after:JSON.parse(JSON.stringify(progress))}});}
async function writeOrders(account,orders){
 if(!orders.length)return;
 const now=new Date();
 const values=orders.map(order=>Prisma.sql`(${randomUUID()},${account.id},'ORDER_HISTORY',${'v1|'+account.sellerId+'|'+order.orderId},${JSON.stringify(order)}::jsonb,${now},${now})`);
 await prisma.$executeRaw(Prisma.sql`INSERT INTO "IntegrationSnapshot" ("id","marketplaceAccountId","category","key","payload","fetchedAt","updatedAt") VALUES ${Prisma.join(values)} ON CONFLICT ("marketplaceAccountId","category","key") DO UPDATE SET "payload"=EXCLUDED."payload","fetchedAt"=EXCLUDED."fetchedAt","updatedAt"=EXCLUDED."updatedAt"`);
}
async function importAccount(account,from,to){
 const auth=new MercadoLivreAuthService(new HttpService(),new ConfigService(process.env),prisma);
 let token='',expires=0;
 const api=new FinanceApi(async force=>{
   if(force||Date.now()>=expires){token=await auth.getValidAccessToken(account.id,!!force);const state=await prisma.marketplaceAccount.findUniqueOrThrow({where:{id:account.id},select:{tokenExpiresAt:true}});expires=Math.min(Date.now()+15*60000,(state.tokenExpiresAt?.getTime()??Date.now()+15*60000)-60000);}return token;
 });
 if(String((await api.get('/users/me')).id)!==account.sellerId)throw Error('Token não corresponde ao vendedor.');
 const fiscal=new Map(),previous=new Map();
 const prior=await prisma.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:{in:['PROFIT_ORDERS','ORDER_HISTORY']}},orderBy:{fetchedAt:'asc'},select:{payload:true}});
 for(const record of prior)for(const row of record.payload?.rows??[])previous.set(row.orderId+':'+row.itemIndex,row);
 async function cost(sku){
   if(fiscal.has(sku))return fiscal.get(sku);
   const saved=await store.get(account.id,'HISTORY_FISCAL','v1|'+account.sellerId+'|'+sku);let value=saved?.payload;
   if(!value){
     const checkedAt=new Date().toISOString();
     try{const data=await api.get('/items/fiscal_information/'+encodeURIComponent(sku));if(String(data.seller_id)!==account.sellerId||data.sku!==sku)throw Error('Cadastro fiscal diferente do SKU/vendedor');value={cost:cents(data.cost),checkedAt};}
     catch{value={cost:null,checkedAt};}
     await store.put(account.id,'HISTORY_FISCAL','v1|'+account.sellerId+'|'+sku,value,new Date(checkedAt));
   }
   fiscal.set(sku,value);return value;
 }
 async function range(start,end,force=false){
   const key='v1|'+account.sellerId+'|'+start+'|'+end;
   const checkpoint=await store.get(account.id,'ORDER_HISTORY_RANGE',key);if(!force&&checkpoint?.payload?.complete){console.log(JSON.stringify({account:account.businessKey,from:start,to:end,resumed:true}));return;}
   let offset=0,total=0,failures=0;
   do{
     progress.current={account:account.businessKey,from:start,to:end,offset,total};await heartbeat();
     const data=await api.get('/orders/search',{seller:account.sellerId,'order.date_created.from':start+'T00:00:00.000-03:00','order.date_created.to':nextDay(end)+'T00:00:00.000-03:00',sort:'date_asc',offset,limit:50});
     if(!Array.isArray(data.results)||!Number.isSafeInteger(data.paging?.total))throw Error('Resposta de paginação inválida.');total=data.paging.total;
     if(total>9500){if(start===end)throw Error('Mais de 9500 pedidos no mesmo dia; precisa dividir por hora.');const mid=new Date((Date.parse(start)+Date.parse(end))/2).toISOString().slice(0,10);await range(start,mid,force);await range(nextDay(mid),end,force);return;}
     if(!data.results.length&&offset<total)throw Error('Página vazia antes de concluir o período.');
     const skus=[...new Set(data.results.flatMap(order=>(order.order_items??[]).map((line,index)=>line.item?.seller_sku??previous.get(String(order.id)+':'+index)?.sku??line.item?.seller_custom_field)).filter(sku=>typeof sku==='string'&&sku.trim()).map(sku=>sku.trim()))];
     let index=0;await Promise.all([0,1].map(async()=>{while(index<skus.length)await cost(skus[index++]);}));
     const orders=[];
     for(const order of data.results)try{const normalized=historyOrder(order,account.sellerId,fiscal,previous,new Date().toISOString());if(normalized.orderDate>=from&&normalized.orderDate<=to)orders.push(normalized);}catch(error){failures++;progress.issues.push({account:account.businessKey,orderId:String(order.id),message:error.message});}
     await writeOrders(account,orders);offset+=data.results.length;progress.processed+=data.results.length;progress.pages++;await heartbeat();
     if(progress.pages%5===0)console.log(JSON.stringify({account:account.businessKey,from:start,to:end,offset,total,processed:progress.processed,pages:progress.pages}));
   }while(offset<total);
   if(failures)throw Error('Alguns pedidos não puderam ser gravados.');
   const entries=await prisma.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'ORDER_HISTORY',AND:[{payload:{path:['orderDate'],gte:start}},{payload:{path:['orderDate'],lte:end}}]},select:{payload:true}});
   const counts=new Map();for(const entry of entries){const order=entry.payload,c=counts.get(order.orderDate)??{orders:0,paid:0};c.orders++;if(order.status==='paid')c.paid++;counts.set(order.orderDate,c);}
   for(let date=start;date<=end;date=nextDay(date))await store.put(account.id,'ORDER_HISTORY_DAY','v1|'+account.sellerId+'|'+date,{date,complete:true,...counts.get(date)??{orders:0,paid:0},checkedAt:new Date().toISOString()});
   await store.put(account.id,'ORDER_HISTORY_RANGE',key,{complete:true,total,checkedAt:new Date().toISOString()});
   console.log(JSON.stringify({account:account.businessKey,from:start,to:end,complete:true,total}));
 }
 const days=await prisma.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'ORDER_HISTORY_DAY',key:{gte:'v1|'+account.sellerId+'|'+from,lte:'v1|'+account.sellerId+'|'+to}},select:{payload:true}});
 const completed=days.filter(r=>r.payload?.complete).map(r=>r.payload.date),plans=orderImportRanges(from,to,completed,Number(arg('--refresh-days')??7));
 for(const plan of plans)for(let start=plan.from;start<=plan.to;){const d=new Date(start),end=[new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10),plan.to].sort()[0];try{await range(start,end,true);}catch(error){progress.issues.push({account:account.businessKey,from:start,to:end,message:error.message});console.log(JSON.stringify({account:account.businessKey,from:start,to:end,error:error.message}));await heartbeat();}start=nextDay(end);}
 const stats=await prisma.$queryRaw(Prisma.sql`SELECT "payload"->>'status' AS status, COUNT(*)::int AS orders FROM "IntegrationSnapshot" WHERE "marketplaceAccountId"=${account.id} AND "category"='ORDER_HISTORY' GROUP BY "payload"->>'status'`);
 const incomplete=await prisma.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS orders FROM "IntegrationSnapshot" s WHERE s."marketplaceAccountId"=${account.id} AND s."category"='ORDER_HISTORY' AND EXISTS (SELECT 1 FROM jsonb_array_elements(s."payload"->'rows') r WHERE r->'fiscalCost'='null'::jsonb OR r->'sellerShipping'='null'::jsonb)`);
 return {account:account.businessKey,orders:stats.reduce((sum,s)=>sum+s.orders,0),statuses:stats,withPendingCosts:incomplete[0].orders};
}
async function main(){
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),to=arg('--to')??today,from=arg('--from')??String(Number(today.slice(0,4))-1)+today.slice(4);
 const accounts=await prisma.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true,...(arg('--account')?{businessKey:arg('--account')}:{})},orderBy:{businessKey:'asc'}});if(!accounts.length)throw Error('Nenhuma conta ativa.');
 job=await prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ORDER_HISTORY_IMPORT'))`;if(await tx.auditLog.count({where:{action:'ORDER_HISTORY_IMPORT',after:{path:['status'],equals:'RUNNING'}}}))throw Error('Uma importação de histórico já está em andamento.');return tx.auditLog.create({data:{action:'ORDER_HISTORY_IMPORT',entityType:'OrderHistoryImport',entityId:randomUUID(),after:{...progress,from,to,startedAt:new Date().toISOString()}}});});
 progress.from=from;progress.to=to;progress.startedAt=new Date().toISOString();console.log(JSON.stringify({jobId:job.id,from,to,accounts:accounts.map(a=>a.businessKey)}));
 for(const account of accounts)try{progress.accounts.push(await importAccount(account,from,to));await heartbeat();}catch(error){progress.issues.push({account:account.businessKey,message:error.message});await heartbeat();}
 progress.status=progress.issues.length?'PARTIAL':'COMPLETED';progress.finishedAt=new Date().toISOString();progress.current=null;await heartbeat();console.log(JSON.stringify(progress));if(progress.issues.length)process.exitCode=2;
}
main().catch(async error=>{progress.status='FAILED';progress.issues.push({message:error.message});await heartbeat().catch(()=>{});console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
