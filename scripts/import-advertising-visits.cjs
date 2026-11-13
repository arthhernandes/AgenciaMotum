#!/usr/bin/env node
// Provider reads only. Persist sanitized daily metrics with resumable checkpoints.
require('dotenv').config({quiet:true});
const {randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');const{join}=require('node:path');
const {PrismaClient,Prisma}=require('@prisma/client');
const {HttpService}=require('@nestjs/axios');const{ConfigService}=require('@nestjs/config');
const {MercadoLivreAuthService}=require('../apps/backend/dist/src/mercadolivre/auth/mercadolivre-auth.service');
const {FinanceApi}=require('../apps/backend/dist/src/reports/finance-api');
const {PersistentSnapshots}=require('../apps/backend/dist/src/reports/persistent-snapshots');
const {dailyTotal,mergeDaily,visitDays,shiftDay,coverVisitsFromTotal,missingDailyRanges}=require('../apps/backend/dist/src/reports/daily-metrics');
const {cents}=require('../apps/backend/dist/src/reports/profitability-calculation');
const {advertisingImportFrom}=require('../apps/backend/dist/src/reports/incremental-ranges');
const p=new PrismaClient(),store=new PersistentSnapshots(p);
let today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
let visitsFrom=new Date(Date.UTC(Number(today.slice(0,4))-2,Number(today.slice(5,7))-1,Number(today.slice(8,10)))).toISOString().slice(0,10),adsFrom=shiftDay(today,-89);
const args=process.argv.slice(2),arg=n=>args.includes(n)?args[args.indexOf(n)+1]:undefined;
const progress={status:'RUNNING',processId:process.pid,startedAt:new Date().toISOString(),visitsFrom,adsFrom,to:today,accounts:[],issues:[]};let job;
let gate=Promise.resolve(),nextRequest=0,cooldown=0,adaptiveInterval=250;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function requestInterval(){
 let configured=250;
 try{const value=JSON.parse(readFileSync(join(__dirname,'../artifacts/metrics-import-control.json'),'utf8'));if(Number.isInteger(value.minIntervalMs)&&value.minIntervalMs>=125&&value.minIntervalMs<=2000)configured=value.minIntervalMs;}catch{}
 return Math.max(configured,adaptiveInterval);
}
// Shared pacing across both sellers; a 429 pauses the whole importer, not just one worker.
async function limitedFetch(url,options){
 let release;const previous=gate;gate=new Promise(resolve=>release=resolve);await previous;
 try{while(Math.max(nextRequest,cooldown)>Date.now())await pause(Math.max(nextRequest,cooldown)-Date.now());progress.intervalMs=requestInterval();nextRequest=Date.now()+progress.intervalMs;progress.requests=(progress.requests??0)+1;}finally{release();}
 // FinanceApi creates its timeout before invoking this transport. Queue/cooldown time is not network time.
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});
 if(response.status===429){progress.throttled=(progress.throttled??0)+1;if(Date.now()>=cooldown)adaptiveInterval=Math.min(2000,Math.ceil(adaptiveInterval*1.15));const delay=Number(response.headers.get('retry-after'));cooldown=Math.max(cooldown,Date.now()+Math.max(60000,(delay||0)*1000));}
 return response;
}
let heartbeatTail=Promise.resolve();
async function heartbeat(){if(job){const after=JSON.parse(JSON.stringify(progress));heartbeatTail=heartbeatTail.catch(()=>{}).then(()=>p.auditLog.update({where:{id:job.id},data:{after}}));await heartbeatTail;}}
async function pool(rows,work){let i=0;await Promise.all(Array.from({length:6},async()=>{while(i<rows.length)await work(rows[i++]);}));}
async function importAccount(account){
 const state={account:account.businessKey,stage:'advertising',groups:0,ads:0,adDays:0,adCostCents:0,visitItems:0,visitWindows:0,visits:0,totalItems:0,errors:0};progress.accounts.push(state);
 const auth=new MercadoLivreAuthService(new HttpService(),new ConfigService(process.env),p);let token='',expires=0;
 const api=new FinanceApi(async force=>{if(force||Date.now()>=expires){token=await auth.getValidAccessToken(account.id,!!force);expires=Date.now()+10*60000;}return token;},limitedFetch,undefined,6);
 if(String((await api.get('/users/me')).id)!==account.sellerId)throw Error('Token não corresponde ao vendedor.');
 const issues=(stage,id,error)=>{state.errors++;progress.issues.push({account:account.businessKey,stage,id,message:error.message});};
 const listings=await p.marketplaceListing.findMany({where:{marketplaceAccountId:account.id},select:{itemId:true}});
 const historic=await p.$queryRaw(Prisma.sql`SELECT DISTINCT r->>'itemId' AS "itemId" FROM "IntegrationSnapshot" s CROSS JOIN LATERAL jsonb_array_elements(s."payload"->'rows') r WHERE s."marketplaceAccountId"=${account.id} AND s."category"='ORDER_HISTORY'`);
 const archivedAds=await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'PRODUCT_ADS_DAILY'},select:{payload:true}});
 const items=new Set([...listings,...historic,...archivedAds.filter(r=>r.payload?.sellerId===account.sellerId).map(r=>({itemId:r.payload.itemId}))].map(r=>r.itemId).filter(id=>/^MLB\d+$/.test(id)));state.totalItems=items.size;
 async function pages(path,params){const rows=[];let offset=0;for(let n=0;n<1000;n++){const data=await api.get(path,{...params,limit:100,offset});if(!Array.isArray(data.results)||!Number.isSafeInteger(data.paging?.total))throw Error('Paginação de publicidade inválida.');rows.push(...data.results);offset+=data.results.length;if(offset>=data.paging.total)return rows;if(!data.results.length)throw Error('Paginação de publicidade incompleta.');}throw Error('Limite de páginas de publicidade excedido.');}
 if(!args.includes('--visits-only'))try{
  const advertisers=(await api.get('/advertising/advertisers',{product_id:'PADS'})).advertisers?.filter(a=>a.site_id==='MLB');
  if(advertisers?.length!==1)throw Error('Anunciante não identificado de forma única.');
  const adStart=advertisingImportFrom(archivedAds.filter(r=>r.payload?.sellerId===account.sellerId).map(r=>r.payload),adsFrom,today);
  state.advertisingFrom=adStart;
  const advertiser=String(advertisers[0].advertiser_id),dates={date_from:adStart,date_to:today,metrics:'cost'};
  const groups=await pages('/advertising/MLB/advertisers/'+advertiser+'/product_ads/ad_groups/search',dates),totals=new Map();state.totalGroups=groups.length;
  await pool([...new Map(groups.map(g=>[String(g.id),g])).values()],async group=>{
   try{
    if(String(group.advertiser_id)!==advertiser||!/^\d+$/.test(String(group.id)))throw Error('Grupo pertence a outro anunciante.');
    const checkpointKey='v1|'+advertiser+'|'+adStart+'|'+today+'|'+group.id;
    let saved=arg('--resume-job')?await store.get(account.id,'PRODUCT_ADS_GROUP_IMPORT',checkpointKey):null,rows=saved?.payload?.rows;
    if(!rows){const ads=await pages('/advertising/MLB/product_ads/ad_groups/'+group.id+'/ads',dates),seen=new Set();rows=[];
     for(const ad of ads){const cost=cents(ad.metrics?.cost);if(String(ad.advertiser_id)!==advertiser||String(ad.ad_group_id)!==String(group.id)||!/^MLB\d+$/.test(ad.item_id)||seen.has(ad.item_id)||cost===null)throw Error('Métrica de anúncio não confirmada.');seen.add(ad.item_id);rows.push({itemId:ad.item_id,cost});}
     await store.put(account.id,'PRODUCT_ADS_GROUP_IMPORT',checkpointKey,{rows,advertiser,groupId:String(group.id)});
    }
    for(const row of rows){const entry=totals.get(row.itemId)??{cost:0,groupId:String(group.id)};entry.cost+=row.cost;totals.set(row.itemId,entry);items.add(row.itemId);}
   }catch(e){issues('advertising-group',String(group.id),e);}state.groups++;
  });
  const existing=await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'PRODUCT_ADS_DAILY'},select:{key:true,payload:true}}),cached=new Map(existing.map(r=>[r.key,r.payload]));
  await pool([...totals],async([itemId,entry])=>{try{
   const key='v1|'+itemId,previous=cached.get(key);let payload=previous;
   const itemFrom=previous?adStart:adsFrom,itemDates={...dates,date_from:itemFrom};let expected=entry.cost;
   if(!arg('--resume-job')||!previous||dailyTotal(previous,itemId,itemFrom,today,'BRL_CENTS')===null){
    // Previously unseen MLBs need their own retained history, even when other ads are incremental.
    if(!previous&&itemFrom<adStart){const full=await pages('/advertising/MLB/product_ads/ad_groups/'+entry.groupId+'/ads',{...itemDates,'filters[item_id]':itemId}),match=full.filter(a=>a.item_id===itemId&&String(a.advertiser_id)===advertiser);if(match.length!==1||cents(match[0].metrics?.cost)===null)throw Error('Histórico do novo anúncio não confirmado.');expected=cents(match[0].metrics.cost);}
    const values={};let total=0;
    if(expected>0){
     // The daily endpoint ignores its group path for aggregation. The SINGULAR item filter is mandatory.
     const daily=await api.get('/advertising/MLB/product_ads/ad_groups/'+entry.groupId+'/ads',{...itemDates,aggregation_type:'daily','filters[item_id]':itemId});
     if(!Array.isArray(daily.results))throw Error('Série diária de publicidade ausente.');
     for(const row of daily.results){const day=row.date,cost=cents(row.cost);if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||day<itemFrom||day>today||day in values||cost===null)throw Error('Série diária de publicidade inválida.');values[day]=cost;total+=cost;}
     for(let day=itemFrom;day<=today;day=shiftDay(day,1))if(!(day in values))throw Error('Série diária de publicidade incompleta.');
     if(total!==expected){
      // Today's spend can grow while group pages are being imported. Recheck the same MLB now.
      const fresh=await pages('/advertising/MLB/product_ads/ad_groups/'+entry.groupId+'/ads',{...itemDates,'filters[item_id]':itemId});
      const match=fresh.filter(a=>a.item_id===itemId&&String(a.advertiser_id)===advertiser);
      if(match.length!==1||cents(match[0].metrics?.cost)!==total)throw Error('Gasto diário não confere com o total atualizado do anúncio.');
     }
    }
    payload=mergeDaily(previous,{itemId,sellerId:account.sellerId,unit:'BRL_CENTS',values,coverage:[{from:itemFrom,to:today}],checkedAt:new Date().toISOString()});
    await store.put(account.id,'PRODUCT_ADS_DAILY',key,payload);
   }
   state.ads++;state.adDays+=90;state.adCostCents+=dailyTotal(payload,itemId,adsFrom,today,'BRL_CENTS');
  }catch(e){issues('advertising-item',itemId,e);}});
 }catch(e){issues('advertising',null,e);}
 if(!args.includes('--ads-only')){
  state.stage='visits';state.totalItems=items.size;await heartbeat();
  const existing=await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:{in:['VISITS_DAILY','VISITS_TOTAL']}},select:{category:true,key:true,payload:true}}),cached=new Map(existing.filter(r=>r.category==='VISITS_DAILY').map(r=>[r.key,r.payload])),totals=new Map(existing.filter(r=>r.category==='VISITS_TOTAL').map(r=>[r.key,r.payload]));
  await pool([...items],async itemId=>{let payload=cached.get('v1|'+itemId),failed=false;
   if(today===new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})&&missingDailyRanges(payload,visitsFrom,today,'visits').length>1)try{
    let saved=totals.get('v1|'+itemId);
    if(saved?.to!==today){const data=await api.get('/visits/items',{ids:itemId}),total=data[itemId];if(!Number.isSafeInteger(total)||total<0)throw Error('Total de visitas não confirmado.');saved={itemId,total,from:visitsFrom,to:today,checkedAt:new Date().toISOString()};await store.put(account.id,'VISITS_TOTAL','v1|'+itemId,saved);}
    totals.set('v1|'+itemId,saved);
    // A confirmed zero over the entire retained history proves zero on each of its days.
    if(saved.total===0){payload=mergeDaily(payload,{itemId,sellerId:account.sellerId,unit:'visits',values:{},coverage:[{from:visitsFrom,to:today}],checkedAt:saved.checkedAt});await store.put(account.id,'VISITS_DAILY','v1|'+itemId,payload);}
   }catch(e){issues('visits-total',itemId,e);}
   // Newest first: current reports become available before the historical backfill ends.
   for(const {from,to} of missingDailyRanges(payload,visitsFrom,today,'visits')){
    if(dailyTotal(payload,itemId,from,to,'visits')===null)try{
     const data=await api.get('/items/'+itemId+'/visits/time_window',{last:(Date.parse(to)-Date.parse(from))/86400000,unit:'day',ending:to});
     payload=mergeDaily(payload,visitDays(data,itemId,account.sellerId,from,to));await store.put(account.id,'VISITS_DAILY','v1|'+itemId,payload);state.visitWindows++;
     const retained=totals.get('v1|'+itemId);
     if(today===new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})&&dailyTotal(payload,itemId,visitsFrom,today,'visits')===null&&from>visitsFrom&&retained&&coverVisitsFromTotal(payload,visitsFrom,today,retained.total))try{
      // Confirm again AFTER the daily read: new visits during the import must not hide older visits.
      const check=await api.get('/visits/items',{ids:itemId}),total=check[itemId];
      if(Number.isSafeInteger(total)&&total>=0){
       const verified={itemId,total,from:visitsFrom,to:today,checkedAt:new Date().toISOString()};totals.set('v1|'+itemId,verified);await store.put(account.id,'VISITS_TOTAL','v1|'+itemId,verified);
       const complete=coverVisitsFromTotal(payload,visitsFrom,today,total);
       if(complete){payload=complete;await store.put(account.id,'VISITS_DAILY','v1|'+itemId,payload);state.zeroRemainders=(state.zeroRemainders??0)+1;break;}
      }
     }catch{/* Optional optimization only. Remaining windows are still imported normally. */}
    }catch(e){issues('visits',itemId+':'+from+':'+to,e);failed=true;break;}
   }
   if(!failed){state.visitItems++;state.visits+=dailyTotal(payload,itemId,visitsFrom,today,'visits')??0;}
  });
 }
 state.stage='finished';await heartbeat();console.log(JSON.stringify(state));
}
async function main(){
 const resumeId=arg('--resume-job');let previous;
 if(resumeId){previous=await p.auditLog.findUniqueOrThrow({where:{id:resumeId}});if(previous.action!=='ADVERTISING_VISITS_IMPORT'||!['RUNNING','PARTIAL','FAILED'].includes(previous.after?.status))throw Error('A execução não pode ser retomada.');
  today=previous.after.to;visitsFrom=previous.after.visitsFrom;adsFrom=previous.after.adsFrom;Object.assign(progress,{to:today,visitsFrom,adsFrom,resumedFrom:resumeId});
 }
 if(args.includes('--probe-visits-window')||args.includes('--probe-visits-multi')){
  const account=await p.marketplaceAccount.findFirstOrThrow({where:{marketplace:'MERCADO_LIVRE',active:true,businessKey:arg('--account')??'outlet4u'}}),auth=new MercadoLivreAuthService(new HttpService(),new ConfigService(process.env),p);
  const token=await auth.getValidAccessToken(account.id),item=await p.marketplaceListing.findFirstOrThrow({where:{marketplaceAccountId:account.id},select:{itemId:true}});
  const ids=(await p.marketplaceListing.findMany({where:{marketplaceAccountId:account.id},take:2,select:{itemId:true}})).map(r=>r.itemId);
  const path=args.includes('--probe-visits-multi')?'/items/visits/time_window?ids='+ids.join(',')+'&last=149':'/items/'+item.itemId+'/visits/time_window?last=730';
  const r=await fetch('https://api.mercadolibre.com'+path+'&unit=day&ending='+today,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)}),data=await r.json();
  console.log(JSON.stringify({status:r.status,itemId:item.itemId,items:Array.isArray(data)?data.map(d=>({id:d.item_id,from:d.date_from,to:d.date_to,total:d.total_visits,days:d.results?.length})):undefined,from:data.date_from,to:data.date_to,total:data.total_visits,days:data.results?.length,error:data.error,message:data.message,retry:r.headers.get('retry-after')}));return;
 }
 const accounts=await p.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true,...arg('--account')?{businessKey:arg('--account')}:{}}});
 if(!accounts.length)throw Error('Nenhuma conta Mercado Livre ativa encontrada.');
 job=await p.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ADVERTISING_VISITS_IMPORT'))`;if(previous)await tx.auditLog.update({where:{id:previous.id},data:{after:{...previous.after,status:'RESUMED_IN_NEXT_JOB',finishedAt:new Date().toISOString()}}});if(await tx.auditLog.count({where:{action:'ADVERTISING_VISITS_IMPORT',after:{path:['status'],equals:'RUNNING'}}}))throw Error('Importação de métricas já em andamento.');return tx.auditLog.create({data:{action:'ADVERTISING_VISITS_IMPORT',entityType:'MetricHistoryImport',entityId:randomUUID(),after:progress}});});
 console.log(JSON.stringify({jobId:job.id,visitsFrom,adsFrom,to:today}));
 const timer=setInterval(()=>{heartbeat().then(()=>console.log(JSON.stringify({status:progress.status,accounts:progress.accounts,errors:progress.issues.length}))).catch(e=>console.error(e.message));},15000);timer.unref();
 try{await Promise.all(accounts.map(a=>importAccount(a).catch(e=>progress.issues.push({account:a.businessKey,message:e.message}))));}finally{clearInterval(timer);}
 progress.status=progress.issues.length?'PARTIAL':'COMPLETED';progress.finishedAt=new Date().toISOString();await heartbeat();console.log(JSON.stringify(progress));if(progress.issues.length)process.exitCode=2;
}
main().catch(async e=>{console.error(e.message);if(job){progress.status='FAILED';progress.issues.push({message:e.message});await heartbeat().catch(()=>{});}process.exitCode=1;}).finally(()=>p.$disconnect());
