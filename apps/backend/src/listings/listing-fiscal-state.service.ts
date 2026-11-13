import { Injectable, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';
import { FinanceApi, FinanceHttpError } from '../reports/finance-api';
import { fiscalState, FiscalState, costCents } from './listing-fiscal-state';
import { ProductCostsService } from '../products/product-costs.service';
import { marketplaceSyncEvents } from '../mercadolivre/sync-events';
type CachedFiscalState=FiscalState&{attempts?:number;retryAt?:number;costChecked?:boolean;costCents?:number|null};
type FiscalTarget={accountId:string;sellerId:string;sku:string;key:string;businessKey:string};

@Injectable()
export class ListingFiscalStateService implements OnModuleInit,OnModuleDestroy {
  private checking=new Map<string,Promise<CachedFiscalState>>();
  private queue:Array<()=>Promise<void>>=[];
  private workers=0;
  private stopped=false;
  private blingRetries=new Map<string,{attempts:number;at:number}>();
  private changed=({accountId,sku}:{accountId:string;sku:string})=>{void this.prisma.integrationSnapshot.deleteMany({where:{marketplaceAccountId:accountId,category:'LISTING_FISCAL_STATE',key:{endsWith:'|'+encodeURIComponent(sku)}}}).catch(()=>{});};
  constructor(private prisma:PrismaService,private auth:MercadoLivreAuthService,@Optional() private costs?:ProductCostsService){}
  onModuleInit(){marketplaceSyncEvents.on('fiscal-updated',this.changed);}
  onModuleDestroy(){marketplaceSyncEvents.off('fiscal-updated',this.changed);this.stopped=true;this.queue=[];}
  async annotate(groups:any[],compareCosts=false,blingAccountIds?:string[]){
    const targets=new Map<string,FiscalTarget>();
    const targetFor=(variant:any)=>{
      const listing=variant.listingData,sku=String(variant.sku??'').trim(),accountId=listing.marketplaceAccountId,sellerId=String(listing.marketplaceAccount.sellerId),key='v1|'+sellerId+'|'+encodeURIComponent(sku);
      return {accountId,sellerId,sku,key,businessKey:String(listing.marketplaceAccount.businessKey??'')};
    };
    for(const group of groups)for(const variant of group.variants){const target=targetFor(variant);if(target.sku)targets.set(target.accountId+'|'+target.key,target);}
    const entries=[...targets.values()],records=entries.length?await this.prisma.integrationSnapshot.findMany({where:{category:'LISTING_FISCAL_STATE',marketplaceAccountId:{in:[...new Set(entries.map(row=>row.accountId))]},key:{in:entries.map(row=>row.key)},expiresAt:{gt:new Date()}},select:{marketplaceAccountId:true,key:true,payload:true}}):[];
    const states=new Map<string,CachedFiscalState>(records.map(row=>[row.marketplaceAccountId+'|'+row.key,row.payload as unknown as CachedFiscalState]));
    const pending=entries.filter(row=>{const state=states.get(row.accountId+'|'+row.key);return !state||state.status==='unknown'||compareCosts&&!state.costChecked;});let cursor=0;
    const eligible=pending.filter(row=>(states.get(row.accountId+'|'+row.key)?.retryAt??0)<=Date.now()).sort((a,b)=>(states.get(a.accountId+'|'+a.key)?.attempts??0)-(states.get(b.accountId+'|'+b.key)?.attempts??0));
    // Drain the entire scope between UI polls, with a global provider concurrency limit.
    const tasks=eligible.map(target=>{
      const id=target.accountId+'|'+target.key;
      let task=this.checking.get(id);
      if(!task){
        task=new Promise<CachedFiscalState>((resolve,reject)=>{
          this.queue.push(async()=>{try{resolve(await this.check(target,states.get(id)));}catch(error){reject(error);}});
        }).finally(()=>this.checking.delete(id));
        this.checking.set(id,task);
      }
      return task.then(state=>states.set(id,state));
    });
    this.drain();
    if(pending.length<=24)await Promise.allSettled(tasks);
    else for(const task of tasks)void task.catch(()=>{});
    const bling=compareCosts?await this.blingCosts(entries,blingAccountIds):{costs:new Map<string,number|null>(),waiting:new Set<string>(),retryTimes:[] as number[]};
    for(const group of groups){let incomplete=0,unknown=0,complete=0,above=0;const reasons=new Set<string>();
      for(const variant of group.variants){const target=targetFor(variant),state=!target.sku?fiscalState(null,'',target.sellerId):states.get(target.accountId+'|'+target.key)??{status:'unknown',reasons:[]};
        if(state.status==='incomplete')incomplete++;else if(state.status==='complete')complete++;else unknown++;
        Object.assign(variant,{fiscalStatus:state.status==='unknown'?'checking':state.status,fiscalReasons:state.status==='unknown'?[]:state.reasons});if(state.status!=='unknown')for(const reason of state.reasons)reasons.add(reason);
        if(compareCosts){const id=target.accountId+'|'+target.key,ml=(state as CachedFiscalState).costCents??null,reference=bling.costs.get(id)??null,exceeds=ml!==null&&reference!==null&&ml>reference;above+=Number(exceeds);Object.assign(variant,{costAboveBling:exceeds,fiscalCost:ml===null?null:ml/100,blingCost:reference===null?null:reference/100});}
      }
      Object.assign(group,{fiscalStatus:incomplete?'incomplete':unknown?'checking':'complete',fiscalIncompleteCount:incomplete,fiscalUnknownCount:unknown,fiscalCompleteCount:complete,fiscalReasons:[...reasons],...(compareCosts?{costAboveBlingCount:above}:{})});
    }
    const unresolved=entries.filter(row=>{const id=row.accountId+'|'+row.key,state=states.get(id);return !state||state.status==='unknown'||compareCosts&&(!state.costChecked||bling.waiting.has(id));}),retryTimes=[...unresolved.map(row=>states.get(row.accountId+'|'+row.key)?.retryAt??0),...bling.retryTimes];
    return {total:entries.length,checked:entries.length-unresolved.length,remaining:unresolved.length,unavailable:[...states.values()].filter(state=>state.status==='unknown').length,nextRetryMs:unresolved.length?Math.max(2000,Math.min(...retryTimes)-Date.now()):0};
  }
  private drain(){
    while(!this.stopped&&this.workers<6&&this.queue.length){
      const job=this.queue.shift()!;this.workers++;
      void job().catch(()=>{}).finally(()=>{this.workers--;this.drain();});
    }
  }
  private async blingCosts(targets:FiscalTarget[],scopeIds?:string[]){
    const costs=new Map<string,number|null>(),waiting=new Set<string>(),retryTimes:number[]=[];
    if(!targets.length)return {costs,waiting,retryTimes};
    const accounts=await this.prisma.marketplaceAccount.findMany({where:{marketplace:'BLING',active:true,...(scopeIds?{id:{in:scopeIds}}:{}),businessKey:{in:[...new Set(targets.map(target=>target.businessKey))]}},select:{id:true,businessKey:true}});
    const business=new Map(accounts.map(account=>[account.id,account.businessKey])),skus=[...new Set(targets.map(target=>target.sku))];
    const products=accounts.length?await this.prisma.product.findMany({where:{blingAccountId:{in:accounts.map(account=>account.id)},variants:{some:{sku:{in:skus}}}},select:{id:true,blingAccountId:true,sku:true,variants:{select:{sku:true}}}}):[];
    const records=products.length?await this.prisma.auditLog.findMany({where:{id:{in:products.map(product=>'bling-costs:'+product.id)},action:'BLING_PRODUCT_COSTS'},select:{entityId:true,after:true}}):[];
    const saved=new Map<string,any>(records.map(record=>[record.entityId,record.after]));
    const fresh=(product:typeof products[number])=>{const cache=saved.get(product.id);return cache?.accountId===product.blingAccountId&&Date.now()-Date.parse(cache.checkedAt)<15*60_000&&Array.isArray(cache.rows)&&product.variants.every(variant=>cache.rows.some((row:any)=>row.sku===variant.sku&&!row.stale));};
    const pending=products.filter(product=>!fresh(product)&&(this.blingRetries.get(product.id)?.at??0)<=Date.now()).slice(0,3);
    for(const product of pending){
      try{
        if(!this.costs)throw Error('Consulta Bling indisponível.');
        const result=await this.costs.find(product.blingAccountId!,product.id,true);saved.set(product.id,result);
        if(result.rows.some((row:any)=>row.stale))throw Error('Consulta Bling incompleta.');this.blingRetries.delete(product.id);
      }catch{const attempts=(this.blingRetries.get(product.id)?.attempts??0)+1;this.blingRetries.set(product.id,{attempts,at:Date.now()+Math.min(5*60_000,5000*2**Math.min(attempts-1,6))});}
    }
    for(const target of targets){
      const id=target.accountId+'|'+target.key,candidates=products.filter(product=>business.get(product.blingAccountId!)===target.businessKey&&product.variants.some(variant=>variant.sku===target.sku));
      if(candidates.length!==1){costs.set(id,null);continue;}
      const product=candidates[0],cache=saved.get(product.id),row=cache?.rows?.find((entry:any)=>entry.sku===target.sku);
      if(!fresh(product)||!row||row.stale){waiting.add(id);retryTimes.push(this.blingRetries.get(product.id)?.at??0);continue;}
      costs.set(id,costCents(row.cost));
    }
    return {costs,waiting,retryTimes};
  }
  private async check(target:{accountId:string;sellerId:string;sku:string;key:string},previous?:CachedFiscalState):Promise<CachedFiscalState>{
    let state:CachedFiscalState;
    try{
      const api=new FinanceApi(force=>this.auth.getValidAccessToken(target.accountId,!!force));
      const record=await api.get('/items/fiscal_information/'+encodeURIComponent(target.sku));state=fiscalState(record,target.sku,target.sellerId);state={...state,costChecked:state.status!=='unknown',costCents:state.status==='unknown'?null:costCents(record.cost)};
    }catch(error){state=error instanceof FinanceHttpError&&error.status===404?{...fiscalState(null,target.sku,target.sellerId),costChecked:true,costCents:null}:{status:'unknown',reasons:['Não foi possível consultar o cadastro fiscal']};}
    if(state.status==='unknown'){const attempts=(previous?.attempts??0)+1;state={...state,attempts,retryAt:Date.now()+Math.min(5*60_000,5000*2**Math.min(attempts-1,6))};}
    const now=new Date(),values={payload:state as any,fetchedAt:now,expiresAt:new Date(now.getTime()+(state.status==='unknown'?24*60*60_000:60*60_000))},identity={marketplaceAccountId:target.accountId,category:'LISTING_FISCAL_STATE',key:target.key};
    await this.prisma.integrationSnapshot.upsert({where:{marketplaceAccountId_category_key:identity},create:{...identity,...values},update:values});return state;
  }
}
