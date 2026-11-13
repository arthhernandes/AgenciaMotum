import { BadRequestException, Injectable, Optional, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { marketplaceSyncEvents } from '../mercadolivre/sync-events';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';
import { AdvertisingTrackerService } from './advertising-tracker.service';
import { membershipPeriods } from './advertising-membership';
import { allocateActiveAdvertising, AdvertisingPeriod, reportAdvertisingPeriods, confirmPeriodAdvertising } from './advertising-allocation';
import { OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, ValidateNested, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';
import { PersistentSnapshots } from './persistent-snapshots';
import { dailyTotal, DailyMetrics, mergeDaily } from './daily-metrics';
import { profitability, cents } from './profitability-calculation';
import { ReportQuery } from './reports.dto';
import { FinanceApi, FinanceHttpError } from './finance-api';
import { ProfitabilityEngine, validateProfitPeriod, validateTaxRate } from './profitability-engine';

export class CachedReportQuery extends ReportQuery {
  @Transform(({value})=>value==='true'?true:value==='false'?false:value) @IsOptional() @IsBoolean() refresh=false;
}
export class ProfitabilityQuery extends CachedReportQuery {
  @Transform(({value})=>value==='true'?true:value==='false'?false:value) @IsOptional() @IsBoolean() cachedOnly=false;
  @Transform(({value})=>value===undefined||value===null||String(value).trim()===''?undefined:Number(value)) @IsOptional() @IsNumber() @Min(0) @Max(100) taxRate?:number;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(0) offset=0;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) limit=10;
}
export class AdvertisingQuery extends CachedReportQuery {
  @Transform(({value})=>value==='true'?true:value==='false'?false:value) @IsOptional() @IsBoolean() cachedOnly=false;
  @IsString() @Matches(/^MLB\d+(,MLB\d+){0,19}$/) itemIds!:string;
}
export class ImportCostsQuery extends OmitType(ProfitabilityQuery,['marketplaceAccountId'] as const) {}
export class RefreshReportListingQuery extends ImportCostsQuery {
  @IsString() @Matches(/^MLB\d+$/) itemId!:string;
}
export class ImportAdvertisingQuery extends OmitType(AdvertisingQuery,['marketplaceAccountId'] as const) {}
class SavedAdvertisingInput {
  @IsString() @Matches(/^\d+$/) orderId!:string;
  @IsInt() @Min(0) @Max(10000) itemIndex!:number;
  @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(1000000000) advertisingCost:number|null=null;
}
class SavedShippingInput {
  @IsString() @Matches(/^\d+$/) orderId!:string;
  @IsInt() @Min(0) @Max(10000) itemIndex!:number;
  @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(1000000000) buyerShippingCredit:number|null=null;
}
export class SaveProfitabilityInputs {
  @IsString() marketplaceAccountId!:string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom!:string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo!:string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) taxRate:number|null=null;
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({each:true}) @Type(()=>SavedAdvertisingInput) manualAdvertising!:SavedAdvertisingInput[];
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ValidateNested({each:true}) @Type(()=>SavedShippingInput) manualShipping?:SavedShippingInput[];
}
@Injectable()
export class ProfitabilityService implements OnModuleInit,OnModuleDestroy {
  private fiscalUpdates=new Map<string,Promise<void>>();
  private fiscalChanged=({accountId,sku,cost}:{accountId:string;sku:string;cost?:unknown})=>{
    this.engines.delete(accountId);
    if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0)return;
    const update=(this.fiscalUpdates.get(accountId)??Promise.resolve()).then(()=>this.updateConfirmedCost(accountId,sku,cost)).catch(()=>{Logger.warn('Não foi possível atualizar os custos fiscais nos relatórios salvos.','ProfitabilityService');});
    this.fiscalUpdates.set(accountId,update);
    void update.finally(()=>{if(this.fiscalUpdates.get(accountId)===update)this.fiscalUpdates.delete(accountId);});
  };
  onModuleInit(){marketplaceSyncEvents.on('fiscal-updated',this.fiscalChanged);}
  onModuleDestroy(){marketplaceSyncEvents.off('fiscal-updated',this.fiscalChanged);}
  private async updateConfirmedCost(accountId:string,sku:string,cost:number){
    await this.prisma.$transaction(async tx=>{
      const records=await tx.integrationSnapshot.findMany({where:{marketplaceAccountId:accountId,category:{in:['ORDER_HISTORY','PROFIT_ORDERS']},payload:{path:['rows'],array_contains:[{sku}]}}});
      for(const record of records){
        const payload=record.payload as any;if(!Array.isArray(payload?.rows))continue;
        const rows=payload.rows.map((row:any)=>{
          if(row.sku!==sku||!Number.isSafeInteger(row.quantity)||row.quantity<=0)return row;
          const fiscalCost=Math.round(cost*100)*row.quantity/100;
          const issues=(row.issues??[]).filter((issue:string)=>!/custo fiscal|cadastro fiscal|Anúncio sem SKU/i.test(issue));
          return {...row,fiscalCost,costCheckedAt:new Date().toISOString(),fiscalCostMessage:null,issues,...profitability(cents(row.revenue),cents(row.commission),cents(row.sellerShipping),cents(fiscalCost),cents(row.invoiceTaxes),row.status==='paid'&&row.currency==='BRL'&&!issues.some((issue:string)=>/estorno|reembolso/i.test(issue)))};
        });
        await tx.integrationSnapshot.update({where:{id:record.id},data:{payload:{...payload,rows},fetchedAt:new Date(),expiresAt:null}});
      }
    },{timeout:30000});
  }
  private engines=new Map<string,{sellerId:string;expires:number;engine:Promise<ProfitabilityEngine>}>();
  private parentCatalog=new Map<string,{expires:number;values:Map<string,{parentSku:string;parentTitle:string;linkedListingCount?:number}>}>();
  constructor(private prisma:PrismaService,private auth:MercadoLivreAuthService,@Optional() private tracker?:AdvertisingTrackerService){}
  private async account(query:ReportQuery){
    if(!query.dateFrom||!query.dateTo)throw new BadRequestException('Selecione o período dos pedidos.');
    try{validateProfitPeriod({dateFrom:query.dateFrom,dateTo:query.dateTo});}catch(e){throw new BadRequestException((e as Error).message);}
    const selected=await this.prisma.marketplaceAccount.findFirst({where:{id:query.marketplaceAccountId,active:true},select:{id:true,businessKey:true,marketplace:true}});
    if(!selected)throw new BadRequestException('Selecione uma conta válida.');
    const account=selected.marketplace==='MERCADO_LIVRE'?await this.prisma.marketplaceAccount.findUnique({where:{id:selected.id},select:{id:true,sellerId:true}}):await this.prisma.marketplaceAccount.findFirst({where:{businessKey:selected.businessKey,marketplace:'MERCADO_LIVRE',active:true},orderBy:{createdAt:'asc'},select:{id:true,sellerId:true}});
    if(!account?.sellerId||!/^\d+$/.test(account.sellerId))throw new BadRequestException('Conecte o Mercado Livre desta conta.');
    return {id:account.id,sellerId:account.sellerId,businessKey:selected.businessKey};
  }
  private async parents(businessKey:string,selectedAccountId?:string){
    const catalogKey=businessKey+'|'+(selectedAccountId??'');const cached=this.parentCatalog.get(catalogKey);if(cached&&cached.expires>Date.now())return cached.values;
    const accounts=await this.prisma.marketplaceAccount.findMany({where:{businessKey,marketplace:'BLING'},select:{id:true}});
    const products=await this.prisma.product.findMany({where:{blingAccountId:{in:accounts.some(account=>account.id===selectedAccountId)?[selectedAccountId!]:accounts.map(account=>account.id)},AND:[{sku:{not:{contains:'.'}}},{OR:[{sku:{not:{contains:'-'}}},{sku:{endsWith:'-LINHA1',mode:'insensitive'}},{sku:{endsWith:'-LINHA2',mode:'insensitive'}}]},{sku:{not:{startsWith:'MLB'}}}]},orderBy:{sku:'asc'},select:{sku:true,title:true,variants:{select:{sku:true}}}});
    const normalize=(sku:string)=>sku.trim().toUpperCase(),values=new Map<string,{parentSku:string;parentTitle:string;linkedListingCount?:number}>(),ambiguous=new Set<string>();
    for(const product of products){
      const parentSku=normalize(product.sku),entry={parentSku,parentTitle:product.title};
      for(const raw of [product.sku,parentSku,...product.variants.map(variant=>variant.sku)]){
        const key=normalize(raw);if(!key||ambiguous.has(key))continue;
        if(values.has(key)&&values.get(key)!.parentSku!==parentSku){values.delete(key);ambiguous.add(key);continue;}
        if(!values.has(key))values.set(key,entry);
      }
    }
    const scopeIds=accounts.some(account=>account.id===selectedAccountId)?[selectedAccountId!]:accounts.map(account=>account.id);
    const linkedListings=await this.prisma.marketplaceListing.findMany({where:{marketplaceAccount:{businessKey,marketplace:'MERCADO_LIVRE',active:true},links:{some:{OR:[{product:{blingAccountId:{in:scopeIds}}},{productVariant:{product:{blingAccountId:{in:scopeIds}}}}]}}},select:{itemId:true,marketplaceAccountId:true,rawData:true,links:{select:{product:{select:{sku:true,blingAccountId:true}},productVariant:{select:{product:{select:{sku:true,blingAccountId:true}}}}}}}});
    const linkedCounts=new Map<string,Set<string>>();
    for(const listing of linkedListings){
      const raw=listing.rawData as any,key='@listing:'+listing.marketplaceAccountId+':'+(raw?.family_id?'family:'+String(raw.family_id):'item:'+listing.itemId);
      for(const link of listing.links??[]){const product=link.productVariant?.product??link.product;if(!product||!scopeIds.includes(product.blingAccountId??''))continue;
        const parent=values.get(normalize(product.sku));if(!parent)continue;const keys=linkedCounts.get(parent.parentSku)??new Set<string>();keys.add(key);linkedCounts.set(parent.parentSku,keys);if(ambiguous.has(key))continue;
        if(values.has(key)&&values.get(key)!.parentSku!==parent.parentSku){values.delete(key);ambiguous.add(key);}else values.set(key,parent);
      }
    }
    for(const parent of values.values())parent.linkedListingCount=linkedCounts.get(parent.parentSku)?.size??0;
    this.parentCatalog.set(catalogKey,{expires:Date.now()+5*60_000,values});return values;
  }
  private async engine(account:{id:string;sellerId:string},refresh=false){
    if(refresh)this.engines.delete(account.id);
    let cached=this.engines.get(account.id);
    if(!cached||cached.expires<Date.now()||cached.sellerId!==account.sellerId){
      const engine=(async()=>{
        let token=await this.auth.getValidAccessToken(account.id);
        const api=new FinanceApi(async refresh=>{if(refresh)token=await this.auth.getValidAccessToken(account.id,true);return token;});
        const seller=await api.get('/users/me');if(String(seller.id)!==account.sellerId)throw new BadRequestException('A autorização não pertence ao vendedor selecionado.');
        return new ProfitabilityEngine(api,account.sellerId!);
      })().catch(error=>{this.engines.delete(account.id);throw error;});
      cached={sellerId:account.sellerId,expires:Date.now()+15*60_000,engine};this.engines.set(account.id,cached);
    }
    return cached.engine;
  }
  private store(){return new PersistentSnapshots(this.prisma);}
  async enrichmentStatus(){
    const job=await this.prisma.auditLog.findFirst({where:{action:'ORDER_HISTORY_ENRICHMENT'},orderBy:{createdAt:'desc'},select:{id:true,after:true,createdAt:true}});
    if(!job)return {status:'NOT_STARTED',accounts:[]};
    const data=job.after as any,count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;
    const accounts=(Array.isArray(data?.accounts)?data.accounts:[]).map((row:any)=>({account:String(row.account ?? 'Loja'),stage:row.stage==='finished'?'finished':'running',total:count(row.total),processed:count(row.processed),updated:count(row.updated),shippingFilled:count(row.shippingFilled),fiscalFilled:count(row.fiscalFilled),failed:count(row.failed)}));
    const total=accounts.reduce((sum:number,row:any)=>sum+row.total,0),processed=accounts.reduce((sum:number,row:any)=>sum+row.processed,0);
    return {id:job.id,status:['RUNNING','COMPLETED','PARTIAL','FAILED'].includes(data?.status)?data.status:'UNKNOWN',startedAt:data?.startedAt??job.createdAt.toISOString(),finishedAt:data?.finishedAt??null,accounts,total,processed,percent:total?Math.min(100,Math.floor(processed/total*100)):0};
  }
  private periodKey(account:{sellerId:string},query:ReportQuery){return 'v1|'+account.sellerId+'|'+query.dateFrom+'|'+query.dateTo;}
  async page(query:ProfitabilityQuery){
    if(query.taxRate!==undefined){try{validateTaxRate(query.taxRate);}catch(e){throw new BadRequestException((e as Error).message);}}
    const account=await this.account(query);
    await this.fiscalUpdates.get(account.id);
    const refreshMarker=await this.store().get(account.id,'PROFIT_REFRESH',this.periodKey(account,query));
    const data=await this.savedReport(account,query,refreshMarker?.fetchedAt);
    if(!data)return {rows:[],errors:[],total:0,processedOrders:0,nextOffset:null,incomplete:false,cacheMiss:true,fromDatabase:true,savedAt:null,offset:0,limit:query.limit};
    const parents=await this.parents(account.businessKey,query.marketplaceAccountId);
    const listings=await this.prisma.marketplaceListing.findMany({where:{marketplaceAccountId:account.id,itemId:{in:[...new Set<string>(data.rows.map((row:any)=>row.itemId).filter(Boolean))]}},select:{itemId:true,title:true,rawData:true,links:{select:{product:{select:{sku:true,blingAccountId:true}},productVariant:{select:{product:{select:{sku:true,blingAccountId:true}}}},listingVariant:{select:{variationId:true}}}}}});
    const listingsById=new Map(listings.map(listing=>[listing.itemId,listing]));
    const listingParents=new Map(listings.map(listing=>{const raw=listing.rawData as any;return [listing.itemId,{parentListingId:raw?.family_id?String(raw.family_id):listing.itemId,parentListingTitle:raw?.family_name||listing.title}];}));
    const missing=[...new Set<string>(data.rows.map((row:any)=>row.itemId).filter((id:string)=>id&&!listingParents.has(id)))];
    if(missing.length){
      const archived=await this.prisma.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'REPORT_LISTING_PARENT',key:{in:missing}},select:{key:true,payload:true}});
      for(const record of archived){const value=record.payload as any;if(value.sellerId===account.sellerId&&value.itemId===record.key&&value.parentListingId)listingParents.set(record.key,value);}
    }
    const rows=data.rows.map((row:any)=>{
      const sku=typeof row.sku==='string'?row.sku.trim().toUpperCase():'';
      let parent=parents.get(sku)??(/^\d+\.\d+$/.test(sku)?parents.get(sku.split('.')[0]):undefined);
      const listing=listingsById.get(row.itemId),linkedParents=new Map<string,{parentSku:string;parentTitle:string;linkedListingCount?:number}>(),allLinkedParents=new Map<string,{parentSku:string;parentTitle:string;linkedListingCount?:number}>();
      for(const link of listing?.links??[]){
        const product=link.productVariant?.product??link.product;
        if(!product||query.marketplaceAccountId!==account.id&&query.marketplaceAccountId&&product.blingAccountId!==query.marketplaceAccountId)continue;
        const confirmed=parents.get(product.sku.toUpperCase());if(!confirmed)continue;
        allLinkedParents.set(confirmed.parentSku,confirmed);
        if(row.variationId!=null?String(link.listingVariant?.variationId)!==String(row.variationId):!!link.listingVariant)continue;
        linkedParents.set(confirmed.parentSku,confirmed);
      }
      if(linkedParents.size===1)parent=[...linkedParents.values()][0];
      else if(!linkedParents.size&&allLinkedParents.size===1)parent=[...allLinkedParents.values()][0];
      else if(!linkedParents.size){
        const raw=listing?.rawData as any,current=row.variationId!=null?raw?.variations?.find((variant:any)=>String(variant.id)===String(row.variationId)):raw;
        const currentSku=sellerSku(current)?.toUpperCase(),currentParent=currentSku?(parents.get(currentSku)??(/^\d+\.\d+$/.test(currentSku)?parents.get(currentSku.split('.')[0]):undefined)):undefined;
        if(currentParent&&(!allLinkedParents.size||allLinkedParents.has(currentParent.parentSku)))parent=currentParent;
        else if(!allLinkedParents.size){
          const identity=listingParents.get(row.itemId)?.parentListingId;
          if(identity)parent=parents.get('@listing:'+account.id+':'+(identity===row.itemId?'item:':'family:')+identity)??parent;
        }
      }
      const revenue=cents(row.revenue),taxes=revenue===null||query.taxRate===undefined?null:Math.round(revenue*query.taxRate/100+Number.EPSILON);
      return {...row,...listingParents.get(row.itemId),parentListingAccountId:account.id,parentSku:parent?.parentSku??null,parentTitle:parent?.parentTitle??null,parentLinkedListingCount:parent?.linkedListingCount??null,taxRate:query.taxRate??null,invoiceTaxes:taxes===null?null:taxes/100,...profitability(revenue,cents(row.commission),cents(row.sellerShipping),cents(row.fiscalCost),taxes,row.profitBeforeTaxes!==null)};
    });
    return {...data,rows,taxRate:query.taxRate??null,fromDatabase:true,savedAt:data.checkedAt};
  }
  async listingParents(query:AdvertisingQuery){
    const account=await this.account(query),report=await this.savedReport(account,query);
    const allowed=new Set<string>((report?.rows??[]).map((row:any)=>row.itemId));
    const ids=[...new Set(query.itemIds.split(','))];
    if(ids.some(id=>!allowed.has(id)))throw new BadRequestException('Anúncio fora dos pedidos deste período.');
    const api=new FinanceApi(force=>this.auth.getValidAccessToken(account.id,!!force));
    const results:any[]=[],errors:string[]=[];let cursor=0;
    await Promise.all(Array.from({length:2},async()=>{while(cursor<ids.length){const itemId=ids[cursor++];try{
      const cached=await this.store().get(account.id,'REPORT_LISTING_PARENT',itemId),saved=cached?.payload as any;
      if(saved?.sellerId===account.sellerId&&saved?.itemId===itemId&&saved?.parentListingId){results.push(saved);continue;}
      const item=await api.get('/items/'+itemId);
      if(item.id!==itemId||String(item.seller_id)!==account.sellerId)throw Error('Identidade do anúncio não confirmada');
      const value={itemId,sellerId:account.sellerId,parentListingId:item.family_id?String(item.family_id):itemId,parentListingTitle:item.family_name||item.title};
      await this.store().put(account.id,'REPORT_LISTING_PARENT',itemId,value);results.push(value);
    }catch{errors.push(itemId);}}}));
    return {results,errors};
  }
  private async savedReport(account:{id:string;sellerId:string},query:ReportQuery,refreshedAt?:Date){
    const prefix='v1|'+account.sellerId+'|';
    const [records,history,days]=await Promise.all([
      this.prisma.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'PROFIT_ORDERS',key:{startsWith:this.periodKey(account,query)+'|'}},orderBy:{fetchedAt:'desc'}}),
      this.prisma.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'ORDER_HISTORY',key:{startsWith:prefix},AND:[{payload:{path:['orderDate'],gte:query.dateFrom!}},{payload:{path:['orderDate'],lte:query.dateTo!}}]},select:{payload:true,fetchedAt:true}}),
      this.prisma.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'ORDER_HISTORY_DAY',key:{gte:prefix+query.dateFrom,lte:prefix+query.dateTo}},select:{payload:true,fetchedAt:true}})
    ]);
    if(!records.length&&!history.length&&!days.length)return null;
    const allPages=records.map(record=>({data:record.payload as any,date:record.fetchedAt})).filter(record=>Array.isArray(record.data?.rows));
    const fresh=refreshedAt?allPages.filter(page=>page.date>=refreshedAt):[],expected=fresh[0]?.data.total;
    let freshEnd=0;
    const freshRanges=fresh.filter(page=>Number.isSafeInteger(page.data.offset)&&Number.isSafeInteger(page.data.processedOrders)).map(page=>[page.data.offset,page.data.offset+page.data.processedOrders]).sort((a,b)=>a[0]-b[0]);
    for(const [start,end]of freshRanges){if(start>freshEnd)break;freshEnd=Math.max(freshEnd,end);}
    const refreshComplete=Number.isSafeInteger(expected)&&expected>=0&&fresh.length>0&&freshEnd>=expected&&fresh.every(page=>!page.data.incomplete&&!page.data.errors?.length);
    const pages=refreshComplete?fresh:allPages,freshIds=new Set(fresh.flatMap(page=>page.data.rows.map((row:any)=>row.orderId))),freshestPage=Math.max(0,...fresh.map(page=>page.date.getTime()));
    const choices=new Map<string,{row:any;date:Date}>(),errors:any[]=[],errorKeys=new Set<string>(),ranges:Array<[number,number]>=[];
    const archiveById=new Map(history.map(record=>[(record.payload as any).orderId,record]));
    for(const {data,date} of pages){
      for(const row of data.rows){const key=row.orderId+':'+row.itemIndex,old=choices.get(key),arch=archiveById.get(row.orderId);if(arch&&arch.fetchedAt>=date&&(arch.payload as any).status!=='paid')continue;if(!old||date>old.date)choices.set(key,{row,date});}
      for(const error of data.errors??[]){const key=error.orderId+':'+error.message;if(!errorKeys.has(key)&&!archiveById.has(error.orderId)){errorKeys.add(key);errors.push(error);}}
    }
    for(const record of history){const order=record.payload as any;if(order.status!=='paid'||refreshComplete&&!freshIds.has(order.orderId)&&record.fetchedAt.getTime()<=freshestPage)continue;for(const row of order.rows??[]){const key=row.orderId+':'+row.itemIndex,old=choices.get(key);if(!old||record.fetchedAt>old.date)choices.set(key,{row,date:record.fetchedAt});}}
    const rows=[...choices.values()].map(value=>value.row),known=new Set(rows.map(row=>row.orderId)).size;
    const coveredDays=new Set(days.filter(record=>(record.payload as any).complete).map(record=>(record.payload as any).date));
    const historyComplete=refreshComplete||coveredDays.size===(Date.parse(query.dateTo!)-Date.parse(query.dateFrom!))/86400000+1;
    const total=historyComplete?known:Math.max(known,Number.isSafeInteger(pages[0]?.data.total)?pages[0].data.total:0);
    for(const {data} of pages)if(Number.isSafeInteger(data.offset)&&Number.isSafeInteger(data.processedOrders))ranges.push([data.offset,Math.min(total,data.offset+data.processedOrders)]);
    ranges.sort((a,b)=>a[0]-b[0]);let end=0,covered=0,firstMissing:number|null=null;
    for(const [start,stop] of ranges){if(stop<=start)continue;if(start>end&&firstMissing===null)firstMissing=end;if(stop>end){covered+=stop-Math.max(start,end);end=stop;}}
    if(end<total&&firstMissing===null)firstMissing=end;
    rows.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.orderId).localeCompare(String(b.orderId))||a.itemIndex-b.itemIndex);
    const dates=[...records,...history,...days].map(record=>record.fetchedAt.getTime());
    return {rows,errors,total,offset:0,processedOrders:historyComplete?total:Math.max(covered,known),nextOffset:null,nextMissingOffset:historyComplete?null:firstMissing,incomplete:!historyComplete&&(firstMissing!==null||pages.some(page=>page.data.incomplete)),checkedAt:new Date(Math.min(...dates)).toISOString()};
  }
  async importCosts(query:ProfitabilityQuery){
    const account=await this.account(query),data=await this.savedReport(account,query);
    const targets=data?.rows??[];
    const batch=targets.slice(query.offset,query.offset+query.limit).filter((row:any)=>row.fiscalCost==null||row.sellerShipping==null),engine=batch.length?await this.engine(account):null;
    const rows:any[]=[];for(const row of batch)rows.push(await engine!.fillMissingCosts(row));
    await this.persistRows(account,query,rows);
    return {rows,nextOffset:query.offset+query.limit<targets.length?query.offset+query.limit:null};
  }
  async refreshListing(query:ProfitabilityQuery&{itemId:string}){
    const account=await this.account(query),report=await this.savedReport(account,query),ids=new Set([query.itemId]);
    const listing=await this.prisma.marketplaceListing.findFirst({where:{marketplaceAccountId:account.id,itemId:query.itemId},select:{rawData:true}}),family=(listing?.rawData as any)?.family_id;
    if(family!==undefined&&family!==null){const siblings=await this.prisma.marketplaceListing.findMany({where:{marketplaceAccountId:account.id,rawData:{path:['family_id'],equals:family}},select:{itemId:true}});for(const sibling of siblings)ids.add(sibling.itemId);}
    const targets=(report?.rows??[]).filter((row:any)=>ids.has(row.itemId));
    if(!targets.length)throw new BadRequestException('Anúncio não encontrado nos pedidos deste período.');
    const engine=await this.engine(account,true),rows=[];
    for(const row of targets)rows.push(await engine.refreshFiscal(row));
    await this.persistRows(account,query,rows);this.parentCatalog.clear();
    return this.page(query);
  }
  private async persistRows(account:{id:string;sellerId:string},query:ReportQuery,rows:any[]){
    // Update the original records so history and report snapshots stay consistent.
    const patches=new Map(rows.map(row=>[row.orderId+':'+row.itemIndex,row]));
    if(rows.length)await this.prisma.$transaction(async tx=>{
      const records=await tx.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,OR:[{category:'ORDER_HISTORY',key:{in:[...new Set(rows.map(row=>'v1|'+account.sellerId+'|'+row.orderId))]}},{category:'PROFIT_ORDERS',key:{startsWith:this.periodKey(account,query)+'|'}}]}});
      for(const record of records){const payload=record.payload as any;if(!Array.isArray(payload?.rows))continue;let changed=false;
        const updated=payload.rows.map((row:any)=>{const patch=patches.get(row.orderId+':'+row.itemIndex);if(!patch||patch.itemId!==row.itemId||patch.quantity!==row.quantity||patch.unitPrice!==row.unitPrice)return row;changed=true;return patch;});
        if(changed)await tx.integrationSnapshot.update({where:{id:record.id},data:{payload:{...payload,rows:updated},fetchedAt:new Date(),expiresAt:null}});
      }
    },{timeout:30000});
  }
  async importAdvertising(query:AdvertisingQuery){
    const account=await this.account(query),engine=await this.engine(account);
    const response=await engine.advertising({dateFrom:query.dateFrom!,dateTo:query.dateTo!},query.itemIds.split(','));
    const cached=await this.advertising(query);
    for(const entry of response.results){
      const previous=cached.results.find(row=>row.itemId===entry.itemId);
      if(entry.cost===null&&previous?.cost!=null){Object.assign(entry,previous);continue;}
      await this.store().put(account.id,'PRODUCT_ADS',this.periodKey(account,query)+'|'+entry.itemId,entry);
    }
    return response;
  }
  async advertisingSummary(query:ReportQuery){
    const account=await this.account(query),key=this.periodKey(account,query);
    const [saved,inventory]=await Promise.all([this.store().get(account.id,'PRODUCT_ADS_PERIOD',key),this.store().get(account.id,'PRODUCT_ADS_PERIOD_REPORT',key)]);
    const verified=(inventory?.payload as any)?.complete===true&&(inventory?.payload as any)?.scope==='all_ads';
    return saved?{...saved.payload as any,verificationRequired:!verified,fromDatabase:true}:{cost:null,complete:false,verificationRequired:true,fromDatabase:true};
  }
  async advertisingAllocation(query:ReportQuery){
    const account=await this.account(query),report=await this.savedReport(account,query);
    const ids=[...new Set<string>((report?.rows??[]).map((row:any)=>row.itemId))];
    const records=await this.prisma.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,OR:[{category:{in:['PRODUCT_ADS_DAILY','PRODUCT_ADS_ACTIVE_WINDOW']},key:{in:ids.map(id=>'v1|'+id)}},{category:'PRODUCT_ADS_PERIOD_REPORT',key:this.periodKey(account,query)}]},select:{category:true,payload:true}});
    const metrics=new Map(records.filter(record=>record.category==='PRODUCT_ADS_DAILY').map(record=>{const data=record.payload as unknown as DailyMetrics;return [data.itemId,data] as const;}));
    const windows=records.filter(record=>record.category==='PRODUCT_ADS_ACTIVE_WINDOW').map(record=>record.payload as any).filter(window=>typeof window.from==='string'&&typeof window.to==='string'&&window.confirmed!==false);
    const periods=new Map<string,AdvertisingPeriod[]>(windows.map(window=>[window.itemId,Array.isArray(window.periods)?window.periods:[{from:window.from,to:window.to}]]));
    const history=await this.tracker?.history(account.id);
    if(history)for(const itemId of ids)periods.set(itemId,membershipPeriods(history,itemId,periods.get(itemId)??[]));
    for(const [itemId,ranges] of periods)periods.set(itemId,reportAdvertisingPeriods(ranges,query.dateFrom!,query.dateTo!));
    const complete=!!report&&!report.incomplete&&!report.errors.length;
    const allocated=allocateActiveAdvertising(report?.rows??[],metrics,account.sellerId,()=>complete,periods);
    const inventory=records.find(record=>record.category==='PRODUCT_ADS_PERIOD_REPORT')?.payload;
    return {results:confirmPeriodAdvertising(report?.rows??[],allocated,inventory,account.sellerId,query.dateFrom!,query.dateTo!,complete),note:'Publicidade conferida com o relatório de despesas do período; o critério usado em campanhas sem vínculo histórico está indicado em Ver detalhes.'};
  }
  async importAdvertisingAllocation(query:ProfitabilityQuery){
    const account=await this.account(query),report=await this.savedReport(account,query);
    if(query.offset===0&&this.tracker)await this.tracker.syncAccount(account.id);
    if(query.offset===0){const saved=await this.store().get(account.id,'PRODUCT_ADS_PERIOD_REPORT',this.periodKey(account,query));if(!saved||Date.now()-saved.fetchedAt.getTime()>15*60_000)await this.importAdvertisingSummary(query);}
    const ids=[...new Set<string>((report?.rows??[]).map((row:any)=>row.itemId))].sort(),errors:any[]=[];
    for(const itemId of ids.slice(query.offset,query.offset+query.limit)){
      const saved=await this.store().get(account.id,'PRODUCT_ADS_DAILY','v1|'+itemId),previous=saved?.payload as unknown as DailyMetrics|undefined;
      let metadataSaved=false;
      try{
        const engine=await this.engine(account),plan=await engine.advertisingCampaignPeriods({dateFrom:query.dateFrom!,dateTo:query.dateTo!}),periods=(plan.get(itemId)??[]).filter(period=>period.from<=period.to);
        if(!periods.length)throw Error('Nenhuma campanha encontrada no período.');
        const from=periods.map(period=>period.from).sort()[0],to=periods.map(period=>period.to).sort().at(-1)!;
        await this.store().put(account.id,'PRODUCT_ADS_ACTIVE_WINDOW','v1|'+itemId,{itemId,from,to,periods});
        metadataSaved=true;
        const required=reportAdvertisingPeriods(periods,query.dateFrom!,query.dateTo!);
        if(!required.length)continue;
        const importFrom=required.map(period=>period.from).sort()[0],importTo=required.map(period=>period.to).sort().at(-1)!;
        if(previous?.sellerId===account.sellerId&&dailyTotal(previous,itemId,importFrom,importTo,'BRL_CENTS')!==null)continue;
        const data=await engine.advertisingDaily({dateFrom:importFrom,dateTo:importTo},itemId);await this.store().put(account.id,'PRODUCT_ADS_DAILY','v1|'+itemId,mergeDaily(previous,data));
      }catch{if(!metadataSaved)await this.store().put(account.id,'PRODUCT_ADS_ACTIVE_WINDOW','v1|'+itemId,{itemId,confirmed:false});errors.push({itemId,message:metadataSaved?'Campanha identificada, mas o histórico completo de gastos não está disponível.':'Nenhuma campanha identificada para o anúncio neste período.'});}
    }
    return {nextOffset:query.offset+query.limit<ids.length?query.offset+query.limit:null,errors};
  }
  async importAdvertisingSummary(query:ReportQuery){
    const account=await this.account(query);
    try{
      const engine=await this.engine(account),inventory=await engine.advertisingInventory({dateFrom:query.dateFrom!,dateTo:query.dateTo!});
      await this.store().put(account.id,'PRODUCT_ADS_PERIOD_REPORT',this.periodKey(account,query),inventory);
      const result={dateFrom:query.dateFrom,dateTo:query.dateTo,cost:inventory.costs.reduce((sum,row)=>sum+row.costCents,0)/100,items:inventory.costs.length,complete:true,checkedAt:inventory.checkedAt};
      await this.store().put(account.id,'PRODUCT_ADS_PERIOD',this.periodKey(account,query),result);return result;
    }catch{throw new BadRequestException('Não foi possível confirmar o total de Product Ads do período. Verifique a conexão e consulte um período dos últimos 90 dias.');}
  }
  async advertising(query:AdvertisingQuery){
    const account=await this.account(query),base=this.periodKey(account,query),results:any[]=[],missing:string[]=[];
    for(const itemId of [...new Set(query.itemIds.split(','))]){
      const saved=await this.store().get(account.id,'PRODUCT_ADS',base+'|'+itemId);
      const daily=await this.store().get(account.id,'PRODUCT_ADS_DAILY','v1|'+itemId),data=daily?.payload as unknown as DailyMetrics|undefined;
      const total=data?.sellerId===account.sellerId?dailyTotal(data,itemId,query.dateFrom!,query.dateTo!,'BRL_CENTS'):null;
      if(total!==null&&(!saved||daily!.fetchedAt>=saved.fetchedAt))results.push({itemId,cost:total/100,source:'Mercado Livre Product Ads',message:null,fromDatabase:true,checkedAt:data!.checkedAt});
      else if(saved)results.push({...saved.payload as any,fromDatabase:true,checkedAt:saved.fetchedAt.toISOString()});
      else results.push({itemId,cost:null,fromDatabase:true,message:'Publicidade ainda não disponível no banco.'});
    }
    return {dateFrom:query.dateFrom,dateTo:query.dateTo,results,cachedOnly:true};
  }
  async inputs(query:ReportQuery){
    const account=await this.account(query),record=await this.store().get(account.id,'PROFIT_INPUTS',this.periodKey(account,query));
    return {saved:!!record,...record?.payload as any,savedAt:record?.fetchedAt.toISOString()??null};
  }
  async saveInputs(query:ReportQuery,input:SaveProfitabilityInputs,userId:string){
    const period={...query,marketplaceAccountId:input.marketplaceAccountId,dateFrom:input.dateFrom,dateTo:input.dateTo},account=await this.account(period);
    const data={taxRate:input.taxRate??null,manualAdvertising:input.manualAdvertising.map(row=>({orderId:row.orderId,itemIndex:row.itemIndex,advertisingCost:row.advertisingCost??0})),manualShipping:(input.manualShipping??[]).map(row=>({orderId:row.orderId,itemIndex:row.itemIndex,buyerShippingCredit:row.buyerShippingCredit??null})),updatedBy:userId};
    const record=await this.store().put(account.id,'PROFIT_INPUTS',this.periodKey(account,period),data);
    return {saved:true,savedAt:record.fetchedAt.toISOString()};
  }

}
