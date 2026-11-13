import { PersistentSnapshots } from '../reports/persistent-snapshots';
import { dailyTotal, DailyMetrics, shiftDay } from '../reports/daily-metrics';
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreClient } from '../mercadolivre/mercadolivre.client';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';

type Metric={itemId:string;visits:number|null;dateFrom?:string;dateTo?:string;checkedAt:string};
@Injectable()
export class ListingVisitsService {
  private cache=new Map<string,{expires:number;value:Metric}>();
  private pending=new Map<string,Promise<void>>();
  private readonly logger=new Logger(ListingVisitsService.name);
  private active=0;private waiting:Array<()=>void>=[];
  private pause(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms));}
  private async read(account:string,ids:string[],period:{dateFrom:string;dateTo:string}|undefined){
    // Bound concurrency across all batches and browser clients, not just one request.
    if(this.active>=2)await new Promise<void>(resolve=>this.waiting.push(resolve));else this.active++;
    try{
      let token=await this.auth.getValidAccessToken(account),refreshed=false;
      for(let attempt=0;;attempt++)try{return await this.client.getItemVisits(token,ids,period);}catch(error){
        const status=(error as any)?.response?.status;
        if(status===401&&!refreshed){token=await this.auth.getValidAccessToken(account,true);refreshed=true;continue;}
        if(attempt>=2||status&&status!==429&&status<500)throw error;
        const seconds=Number((error as any)?.response?.headers?.['retry-after']);
        await this.pause(status===429?Math.min(10000,Math.max(1000,(seconds||1)*1000)):500*(attempt+1));
      }
    }finally{const next=this.waiting.shift();if(next)next();else this.active--;}
  }
  constructor(private prisma:PrismaService,private client:MercadoLivreClient,private auth:MercadoLivreAuthService){}
  async find(accountId:string,requested:string[],dateFrom?:string,dateTo?:string){
    let period:{dateFrom:string;dateTo:string}|undefined;
    if(dateFrom!==undefined||dateTo!==undefined){
      const valid=(value:string|undefined)=>!!value&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
      if(!valid(dateFrom)||!valid(dateTo))throw new BadRequestException('Informe uma data inicial e final válidas.');
      const start=Date.parse(dateFrom!),end=Date.parse(dateTo!);
      const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
      if(end<start||dateTo!>today||dateFrom!>today)throw new BadRequestException('Confira a ordem das datas. Não use datas futuras.');
      if((end-start)/86400000+1>150)throw new BadRequestException('Selecione um intervalo de até 150 dias.');
      // The interval endpoint requires YYYY-MM-DD and includes both selected dates.
      period={dateFrom:dateFrom!,dateTo:dateTo!};
    }
    const rangeKey=dateFrom&&dateTo?dateFrom+':'+dateTo:'30:'+new Date().toISOString().slice(0,10);
    const cacheKey=(account:string,item:string)=>account+':'+item+':'+rangeKey;
    const ids=[...new Set(requested)];
    const selected=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,active:true},select:{id:true,businessKey:true,marketplace:true}});
    if(!selected)throw new BadRequestException('Selecione uma conta válida.');
    const listings=await this.prisma.marketplaceListing.findMany({where:{itemId:{in:ids},...(selected.marketplace==='BLING'?{marketplaceAccount:{businessKey:selected.businessKey,marketplace:'MERCADO_LIVRE'}}:{marketplaceAccountId:selected.id})},select:{itemId:true,marketplaceAccountId:true}});
    if(ids.some(id=>!listings.some(listing=>listing.itemId===id)))throw new ForbiddenException('Um anúncio não pertence à conta selecionada.');
    const saved=await this.prisma.integrationSnapshot.findMany({where:{category:'LISTING_VISITS',marketplaceAccountId:{in:[...new Set(listings.map(row=>row.marketplaceAccountId))]},key:{in:ids.map(id=>rangeKey+':'+id)},expiresAt:{gt:new Date()}}});
    for(const record of saved){const value=record.payload as any;if(ids.includes(value.itemId)&&Number.isSafeInteger(value.visits)&&value.visits>=0)this.cache.set(cacheKey(record.marketplaceAccountId,value.itemId),{value,expires:record.expiresAt!.getTime()});}
    const archived=await this.prisma.integrationSnapshot.findMany({where:{category:'VISITS_DAILY',marketplaceAccountId:{in:[...new Set(listings.map(row=>row.marketplaceAccountId))]},key:{in:ids.map(id=>'v1|'+id)}}});
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),from=period?.dateFrom??shiftDay(today,-30),to=period?.dateTo??today;
    for(const record of archived){
      const data=record.payload as unknown as DailyMetrics,visits=dailyTotal(data,data.itemId,from,to,'visits');
      if(visits===null||!ids.includes(data.itemId)||!listings.some(row=>row.itemId===data.itemId&&row.marketplaceAccountId===record.marketplaceAccountId))continue;
      const key=cacheKey(record.marketplaceAccountId,data.itemId),current=this.cache.get(key);
      if(current&&current.expires>Date.now()&&current.value.checkedAt>data.checkedAt)continue;
      this.cache.set(key,{value:{itemId:data.itemId,visits,dateFrom:from,dateTo:to,checkedAt:data.checkedAt},expires:Date.now()+15*60000});
    }
    const byAccount=new Map<string,string[]>();
    for(const listing of listings){const key=cacheKey(listing.marketplaceAccountId,listing.itemId);if((this.cache.get(key)?.expires??0)>Date.now())continue;const group=byAccount.get(listing.marketplaceAccountId)??[];group.push(listing.itemId);byAccount.set(listing.marketplaceAccountId,group);}
    const chunks:Array<{account:string;ids:string[]}>=[];
    // The current Visits API accepts one item per request. Keep concurrency bounded.
    for(const [account,items] of byAccount)for(const itemId of items)chunks.push({account,ids:[itemId]});
    let index=0;
    const worker=async()=>{while(index<chunks.length){const chunk=chunks[index++];const key=cacheKey(chunk.account,[...chunk.ids].sort().join(','));let request=this.pending.get(key);if(!request){request=this.fetch(chunk.account,chunk.ids,period,rangeKey);this.pending.set(key,request);}try{await request;}finally{this.pending.delete(key);}}};
    await Promise.all([worker(),worker()]);
    const items=ids.map(itemId=>{const listing=listings.find(listing=>listing.itemId===itemId)!;return this.cache.get(cacheKey(listing.marketplaceAccountId,itemId))?.value??{itemId,visits:null,checkedAt:new Date().toISOString()};});
    // Bound the cache while retaining the rows being returned by this request.
    if(this.cache.size>20000)for(const key of [...this.cache.keys()].slice(0,this.cache.size-20000))this.cache.delete(key);
    return {days:dateFrom&&dateTo?(Date.parse(dateTo)-Date.parse(dateFrom))/86400000+1:30,dateFrom,dateTo,items};
  }
  private async fetch(account:string,ids:string[],period:{dateFrom:string;dateTo:string}|undefined,rangeKey:string){
    const values=new Map<string,Metric>();const checkedAt=new Date().toISOString();
    try{
      const response=await this.read(account,ids,period);
      if(Array.isArray(response))for(const entry of response){const value=entry?.body??entry;if(ids.includes(value?.item_id)&&Number.isSafeInteger(value.total_visits)&&value.total_visits>=0)values.set(value.item_id,{itemId:value.item_id,visits:value.total_visits,dateFrom:typeof value.date_from==='string'?value.date_from:undefined,dateTo:typeof value.date_to==='string'?value.date_to:undefined,checkedAt});}
    }catch(error){this.logger.warn('Visits unavailable item='+ids.join(',')+' status='+((error as any)?.response?.status??'network'));}
    // Keep the result for this response, but do not cache a failed read for future retries.
    for(const itemId of ids){const value=values.get(itemId)??{itemId,visits:null,checkedAt};this.cache.set(account+':'+itemId+':'+rangeKey,{value,expires:Date.now()+(value.visits===null?0:15*60_000)});if(value.visits!==null)await new PersistentSnapshots(this.prisma).put(account,'LISTING_VISITS',rangeKey+':'+itemId,value,new Date(checkedAt),15*60_000);}
  }
}
