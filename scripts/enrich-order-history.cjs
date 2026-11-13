#!/usr/bin/env node
require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const {HttpService}=require('@nestjs/axios');const {ConfigService}=require('@nestjs/config');
const {MercadoLivreAuthService}=require('../apps/backend/dist/src/mercadolivre/auth/mercadolivre-auth.service');
const {FinanceApi}=require('../apps/backend/dist/src/reports/finance-api');
const {ProfitabilityEngine}=require('../apps/backend/dist/src/reports/profitability-engine');
const {PersistentSnapshots}=require('../apps/backend/dist/src/reports/persistent-snapshots');
const {cents,money,profitability}=require('../apps/backend/dist/src/reports/profitability-calculation');
const {signature,restoreCheckpoints}=require('./lib/enrichment-checkpoints.cjs');let resumeChain=[];
const p=new PrismaClient(),store=new PersistentSnapshots(p),args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const progress={status:'RUNNING',processId:process.pid,accounts:[],issues:[],requests:0,throttled:0};let job,heartbeatQueue=Promise.resolve(),nextRequest=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function limitedFetch(url,options){
 const start=Math.max(Date.now(),nextRequest);nextRequest=start+400;await pause(Math.max(0,start-Date.now()));progress.requests++;
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});
 if(response.status===429){progress.throttled++;nextRequest=Math.max(nextRequest,Date.now()+60000);}
 return response;
}
function heartbeat(){if(!job)return Promise.resolve();progress.lastHeartbeatAt=new Date().toISOString();const snapshot=JSON.parse(JSON.stringify(progress));heartbeatQueue=heartbeatQueue.catch(()=>{}).then(()=>p.auditLog.update({where:{id:job.id},data:{after:snapshot}}));return heartbeatQueue;}
function issue(account,orderId,message){if(progress.issues.length<100)progress.issues.push({account,orderId,message});}
function localOrder(data,sellerId){return {id:data.orderId,seller:{id:sellerId},status:data.status,currency_id:data.currency,date_created:data.createdAt,pack_id:data.packId,shipping:data.shipmentId?{id:data.shipmentId}:null,order_items:(data.rows??[]).map(row=>({quantity:row.quantity,unit_price:row.unitPrice,item:{id:row.itemId,variation_id:row.variationId,seller_sku:row.sku}}))};}
async function accountRun(account){
 const records=await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'ORDER_HISTORY'},orderBy:{key:'asc'},select:{id:true,key:true,payload:true}});
 const orders=new Map(records.map(record=>[record.payload.orderId,record.payload]));
 const plan=await restoreCheckpoints(p,store,account,records,progress.scopeId,resumeChain),targets=plan.targets;
 const stats={account:account.businessKey,total:plan.scope.length,processed:plan.processed,...plan.baseline,remainingShipping:0,remainingFiscal:0,failed:0,stage:'running'};progress.accounts.push(stats);await heartbeat();
 if(!targets.length){for(const record of plan.scope)for(const row of record.payload.rows??[]){if(row.sellerShipping===null)stats.remainingShipping++;if(row.fiscalCost===null)stats.remainingFiscal++;}stats.stage='finished';await heartbeat();console.log(JSON.stringify(stats));return;}
 const auth=new MercadoLivreAuthService(new HttpService(),new ConfigService(process.env),p);let token='',expires=0;
 const api=new FinanceApi(async force=>{if(force||Date.now()>=expires){token=await auth.getValidAccessToken(account.id,!!force);const saved=await p.marketplaceAccount.findUniqueOrThrow({where:{id:account.id},select:{tokenExpiresAt:true}});expires=Math.min(Date.now()+15*60000,(saved.tokenExpiresAt?.getTime()??Date.now()+15*60000)-60000);}return token;},limitedFetch,pause,2);
 if(String((await api.get('/users/me')).id)!==account.sellerId)throw Error('Token pertence a outro vendedor.');
 const endpointCache=new Map(),fiscalCache=new Map();
 const cachedApi={get:async(path,params)=>{
   const match=/^\/orders\/(\d+)$/.exec(path);if(match&&orders.has(match[1]))return localOrder(orders.get(match[1]),account.sellerId);
   const kind=/^\/shipments\/\d+\/costs$/.test(path)?'HISTORY_SHIPPING_COSTS':/^\/shipments\/\d+\/items$/.test(path)?'HISTORY_SHIPPING_ITEMS':null;
   if(!kind)return api.get(path,params);
   if(endpointCache.has(path))return endpointCache.get(path);
   const pending=(async()=>{
    const saved=await store.get(account.id,kind,'v1|'+account.sellerId+'|'+path);if(saved)return saved.payload;
    const result=await api.get(path,params);
    const payload=kind==='HISTORY_SHIPPING_COSTS'?{receiver:{cost:result.receiver?.cost??null},senders:(result.senders??[]).map(row=>({user_id:row.user_id,cost:row.cost??null}))}:(Array.isArray(result)?result:result.items??[]).map(row=>({order_id:row.order_id,sender_id:row.sender_id??row.seller_id??account.sellerId}));
    if(kind==='HISTORY_SHIPPING_ITEMS'&&!payload.length)throw Error('Envio sem itens confirmados');
    if(kind==='HISTORY_SHIPPING_COSTS'&&cents(payload.senders.find(row=>String(row.user_id)===account.sellerId)?.cost)===null)throw Error('Frete do vendedor indisponível');
    await store.put(account.id,kind,'v1|'+account.sellerId+'|'+path,payload);return payload;
   })();endpointCache.set(path,pending);return pending;
 }};
 const engine=new ProfitabilityEngine(cachedApi,account.sellerId);
 async function fiscal(row){
  const sku=row.sku;if(!sku)return null;
  if(fiscalCache.has(sku))return fiscalCache.get(sku);
  const pending=(async()=>{
   const key='v1|'+account.sellerId+'|'+sku,saved=await store.get(account.id,'HISTORY_FISCAL',key);if(saved?.payload?.cost!==null&&saved?.payload?.cost!==undefined)return saved.payload;
   try{const data=await api.get('/items/fiscal_information/'+encodeURIComponent(sku));if(String(data.seller_id)!==account.sellerId||data.sku!==sku)throw Error('Cadastro fiscal de outro SKU/vendedor');const cost=cents(data.cost);if(cost===null)return null;const value={cost,checkedAt:new Date().toISOString()};await store.put(account.id,'HISTORY_FISCAL',key,value);return value;}catch(error){if(error.status===404)return null;throw error;}
  })();fiscalCache.set(sku,pending);return pending;
 }
 const cap=Number(arg('--limit')??targets.length);if(!Number.isInteger(cap)||cap<0)throw Error('Limite inválido');
 let cursor=0;
 await Promise.all([0,1].map(async()=>{while(cursor<Math.min(cap,targets.length)){
  const record=targets[cursor++],data=record.payload,order=localOrder(data,account.sellerId),patches=[];let reviewed=true,updatedCount=0,shippingCount=0,fiscalCount=0;
  try{
   for(const row of data.rows??[]){const patch={itemIndex:row.itemIndex,itemId:row.itemId,quantity:row.quantity,unitPrice:row.unitPrice};let changed=false;
    if(row.sellerShipping===null)try{const result=await engine.shippingFor(order,row.itemIndex);if(result.seller!==null){patch.sellerShipping=money(result.seller);patch.buyerShipping=money(result.buyer);changed=true;}else reviewed=false;}catch(e){reviewed=false;issue(account.businessKey,data.orderId,e.message);}
    if(row.fiscalCost===null)try{const value=await fiscal(row);if(value&&Number.isSafeInteger(row.quantity)&&row.quantity>0){patch.fiscalCost=money(value.cost*row.quantity);patch.costCheckedAt=value.checkedAt;changed=true;}}catch(e){reviewed=false;issue(account.businessKey,data.orderId,e.message);}
    if(changed)patches.push(patch);
   }
   if(patches.length){
    await p.$transaction(async tx=>{
     const current=await tx.integrationSnapshot.findUniqueOrThrow({where:{id:record.id}}),latest=current.payload;
     let shipping=0,fiscal=0;
     const rows=latest.rows.map(row=>{const patch=patches.find(value=>value.itemIndex===row.itemIndex&&value.itemId===row.itemId&&value.quantity===row.quantity&&value.unitPrice===row.unitPrice);if(!patch)return row;
      const updated={...row};if(row.sellerShipping===null&&patch.sellerShipping!==undefined){updated.sellerShipping=patch.sellerShipping;updated.buyerShipping=patch.buyerShipping;shipping++;}
      if(row.fiscalCost===null&&patch.fiscalCost!==undefined){updated.fiscalCost=patch.fiscalCost;updated.costCheckedAt=patch.costCheckedAt;fiscal++;}
      const issues=(row.issues??[]).filter(message=>!(updated.sellerShipping!==null&&(/Frete do vendedor|consultar ou ratear o frete/.test(message)))&&!(updated.fiscalCost!==null&&(/Custo fiscal|custo fiscal por SKU/.test(message))));
      const eligible=latest.status==='paid'&&latest.currency==='BRL'&&!issues.some(message=>/estorno|reembolso/i.test(message));
      return {...updated,issues,...profitability(cents(updated.revenue),cents(updated.commission),cents(updated.sellerShipping),cents(updated.fiscalCost),cents(updated.invoiceTaxes),eligible)};
     });
     if(shipping||fiscal){const now=new Date();await tx.integrationSnapshot.update({where:{id:record.id},data:{payload:{...latest,rows,financialEnrichedAt:now.toISOString()},fetchedAt:now,expiresAt:null}});stats.updated++;stats.shippingFilled+=shipping;stats.fiscalFilled+=fiscal;updatedCount=1;shippingCount=shipping;fiscalCount=fiscal;}
    });
   }
  }catch(e){reviewed=false;issue(account.businessKey,data.orderId,e.message);}
  if(!reviewed)stats.failed++;
  const old=plan.checked.get(data.orderId);
  await store.put(account.id,'ORDER_ENRICHMENT_CHECK','v1|'+account.sellerId+'|'+data.orderId,{orderId:data.orderId,signature:signature(data),complete:reviewed,checkedAt:new Date().toISOString(),updated:(old?.updated??0)+updatedCount,shippingFilled:(old?.shippingFilled??0)+shippingCount,fiscalFilled:(old?.fiscalFilled??0)+fiscalCount});
  stats.processed++;if(stats.processed%50===0){console.log(JSON.stringify(stats));await heartbeat();}
 }}));
 const remaining=await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'ORDER_HISTORY',payload:{path:['status'],equals:'paid'}},select:{payload:true}});
 for(const entry of remaining)for(const row of entry.payload.rows??[]){if(row.sellerShipping===null)stats.remainingShipping++;if(row.fiscalCost===null)stats.remainingFiscal++;}
 stats.stage='finished';await heartbeat();console.log(JSON.stringify(stats));
}
async function main(){
 job=await p.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ORDER_HISTORY_ENRICHMENT'))`;
 const resumeId=arg('--resume-job');if(resumeId){const old=await tx.auditLog.findUniqueOrThrow({where:{id:resumeId}});let ancestor=old;while(ancestor){resumeChain.push(ancestor);ancestor=ancestor.after?.resumedFrom?await tx.auditLog.findUnique({where:{id:ancestor.after.resumedFrom}}):null;}if(old.action!=='ORDER_HISTORY_ENRICHMENT'||!['RUNNING','PARTIAL','FAILED'].includes(old.after?.status))throw Error('Conferência não pode ser retomada.');if(old.after.processId){let alive=false;try{process.kill(old.after.processId,0);alive=true;}catch(e){if(e.code!=='ESRCH')alive=true;}if(alive)throw Error('O processo anterior ainda existe; não será iniciada outra cópia.');}await tx.auditLog.update({where:{id:resumeId},data:{after:{...old.after,status:'RESUMED_IN_NEXT_JOB'}}});progress.resumedFrom=resumeId;}
 if(await tx.auditLog.count({where:{action:'ORDER_HISTORY_ENRICHMENT',after:{path:['status'],equals:'RUNNING'}}}))throw Error('Já existe uma conferência de custos em andamento.');return tx.auditLog.create({data:{action:'ORDER_HISTORY_ENRICHMENT',entityType:'OrderHistoryEnrichment',entityId:require('crypto').randomUUID(),after:progress}});});
 progress.scopeId=resumeChain.at(-1)?.after?.scopeId??resumeChain.at(-1)?.id??job.id;
 progress.startedAt=new Date().toISOString();console.log(JSON.stringify({jobId:job.id}));await heartbeat();
 const timer=setInterval(()=>heartbeat().catch(()=>{}),15000);
 try{const accounts=await p.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true,...(arg('--account')?{businessKey:arg('--account')}:{})},orderBy:{businessKey:'desc'}});await Promise.all(accounts.map(async account=>{try{await accountRun(account);}catch(e){issue(account.businessKey,null,e.message);}}));
 progress.status=progress.accounts.some(account=>account.failed||account.remainingShipping||account.remainingFiscal)||progress.issues.length?'PARTIAL':'COMPLETED';progress.finishedAt=new Date().toISOString();
 }finally{clearInterval(timer);await heartbeat();}
 console.log(JSON.stringify(progress));
}
main().catch(async e=>{progress.status='FAILED';progress.issues.push({message:e.message});await heartbeat().catch(()=>{});console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
