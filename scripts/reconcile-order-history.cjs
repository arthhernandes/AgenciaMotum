require('dotenv').config({quiet:true});
const {randomUUID}=require('node:crypto');
const {PrismaClient,Prisma}=require('@prisma/client');
const {HttpService}=require('@nestjs/axios');
const {ConfigService}=require('@nestjs/config');
const {MercadoLivreAuthService}=require('../apps/backend/dist/src/mercadolivre/auth/mercadolivre-auth.service');
const {FinanceApi}=require('../apps/backend/dist/src/reports/finance-api');
const {historyOrder}=require('../apps/backend/dist/src/reports/order-history');
const p=new PrismaClient();
const args=process.argv.slice(2),business=args.includes('--account')?args[args.indexOf('--account')+1]:null;
const tailOnly=args.includes('--tail-only');
const next=day=>new Date(Date.parse(day)+86400000).toISOString().slice(0,10);
async function main(){
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),from=String(Number(today.slice(0,4))-1)+today.slice(4);
 for(const account of await p.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true,...business?{businessKey:business}:{}}})){
   const auth=new MercadoLivreAuthService(new HttpService(),new ConfigService(process.env),p);let token=await auth.getValidAccessToken(account.id);
   const api=new FinanceApi(async refresh=>{if(refresh)token=await auth.getValidAccessToken(account.id,true);return token;});
   if(String((await api.get('/users/me')).id)!==account.sellerId)throw Error('Vendedor não corresponde ao token.');
   const entries=await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'ORDER_HISTORY'},select:{payload:true}}),known=new Set(entries.map(r=>r.payload.orderId));
   const fiscal=new Map((await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'HISTORY_FISCAL'}})).map(r=>[r.key.split('|').slice(2).join('|'),r.payload]));
   let total=(await api.get('/orders/search',{seller:account.sellerId,limit:1})).paging.total,added=0;
   for(let round=0;(round===0||known.size<total)&&round<3;round++){
     const limit=[50,37,43][round],ranges=[];
     if(tailOnly||total<=9500)ranges.push({});else for(let start=from;start<=today;){const d=new Date(start),end=[new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10),today].sort()[0];ranges.push({'order.date_created.from':start+'T00:00:00.000-03:00','order.date_created.to':next(end)+'T00:00:00.000-03:00'});start=next(end);}
     for(const range of ranges){let offset=0,size=0;do{
       const result=await api.get('/orders/search',{seller:account.sellerId,sort:tailOnly?'date_desc':'date_asc',limit,offset,...range});size=result.paging.total;if(size>9500&&!tailOnly)throw Error('Intervalo de conferência excedeu 9500 pedidos.');if(!result.results.length&&offset<size)throw Error('Conferência retornou página vazia.');
       for(const order of result.results)if(!known.has(String(order.id))){
         const data=historyOrder(order,account.sellerId,fiscal,new Map(),new Date().toISOString()),key='v1|'+account.sellerId+'|'+data.orderId;
         await p.integrationSnapshot.upsert({where:{marketplaceAccountId_category_key:{marketplaceAccountId:account.id,category:'ORDER_HISTORY',key}},create:{marketplaceAccountId:account.id,category:'ORDER_HISTORY',key,payload:data},update:{payload:data,fetchedAt:new Date()}});known.add(data.orderId);added++;
         console.log(JSON.stringify({account:account.businessKey,added:1,orderId:data.orderId,createdAt:data.createdAt}));
       }
       offset+=result.results.length;
     }while(offset<size&&(!tailOnly||offset<500));}
     total=(await api.get('/orders/search',{seller:account.sellerId,limit:1})).paging.total;
     console.log(JSON.stringify({account:account.businessKey,round:round+1,available:total,stored:known.size,added}));
   }
   const complete=known.size>=total;
   await p.auditLog.create({data:{action:'ORDER_HISTORY_RECONCILIATION',entityType:'OrderHistoryImport',entityId:randomUUID(),after:{status:complete?'COMPLETED':'PARTIAL',account:account.businessKey,available:total,stored:known.size,added,checkedAt:new Date().toISOString()}}});
   console.log(JSON.stringify({account:account.businessKey,complete,available:total,stored:known.size,added}));if(!complete)process.exitCode=2;
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>p.$disconnect());
