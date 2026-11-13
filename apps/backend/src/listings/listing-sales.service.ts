import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';
import { FinanceApi } from '../reports/finance-api';
import { PersistentSnapshots } from '../reports/persistent-snapshots';

@Injectable()
export class ListingSalesService {
 private apis=new Map<string,FinanceApi>();private pending=new Map<string,Promise<any>>();
 private rankingProgress=new Map<string,{started:number;tasks:string[];status:'LOADING'|'COMPLETE'|'FAILED'}>();
 private taskProgress=new Map<string,{completed:number;total:number}>();
 progress(accountId:string,id:string){
  const progress=this.rankingProgress.get(accountId+'|'+id);
  if(!progress)return {percent:0,completed:0,total:0,status:'PENDING'};
  const counts=progress.tasks.map(key=>this.taskProgress.get(key)).filter((value):value is {completed:number;total:number}=>!!value);
  const completed=counts.reduce((sum,value)=>sum+value.completed,0),total=counts.reduce((sum,value)=>sum+value.total,0);
  return {completed,total,status:progress.status,percent:progress.status==='COMPLETE'?100:total?Math.min(99,Math.floor(completed/total*100)):0};
 }
 constructor(private prisma:PrismaService,private auth:MercadoLivreAuthService){}
 async ranking(accountId:string,requested:string[],from:string,to:string,progressId?:string){
  const valid=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date??'')&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  if(!valid(from)||!valid(to)||from>to||to>today||(Date.parse(to)-Date.parse(from))/86400000>=150)throw new BadRequestException('Selecione um período válido de até 150 dias para ordenar as vendas.');
  const selected=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,active:true},select:{id:true,businessKey:true,marketplace:true}});
  if(!selected)throw new BadRequestException('Selecione uma conta válida.');
  const progressKey=progressId?accountId+'|'+progressId:undefined;
  if(progressKey){for(const [key,value] of this.rankingProgress)if(Date.now()-value.started>30*60_000||this.rankingProgress.size>=1000)this.rankingProgress.delete(key);this.rankingProgress.set(progressKey,{started:Date.now(),tasks:[],status:'LOADING'});}
  const ids=[...new Set(requested)];
  const listings=await this.prisma.marketplaceListing.findMany({where:{itemId:{in:ids},...(selected.marketplace==='BLING'?{marketplaceAccount:{businessKey:selected.businessKey,marketplace:'MERCADO_LIVRE'}}:{marketplaceAccountId:selected.id})},select:{itemId:true,marketplaceAccountId:true,marketplaceAccount:{select:{sellerId:true}}}});
  if(ids.some(id=>!listings.some(row=>row.itemId===id)))throw new ForbiddenException('Anúncio fora da conta selecionada.');
  const accounts=[...new Map(listings.map(row=>[row.marketplaceAccountId,String(row.marketplaceAccount.sellerId)])).entries()];
  if(progressKey)this.rankingProgress.get(progressKey)!.tasks=accounts.map(([account])=>[account,from,to].join('|'));
  for(const [account] of accounts)if(!this.pending.has(['ranking',account,from,to].join('|')))this.taskProgress.set([account,from,to].join('|'),{completed:0,total:(Date.parse(to)-Date.parse(from))/86400000+1});
  const values=new Map<string,any>();
  try{for(const [account,seller] of accounts){const key=['ranking',account,from,to].join('|');let task=this.pending.get(key);if(!task){task=this.readRanking(account,seller,from,to).finally(()=>this.pending.delete(key));this.pending.set(key,task);}for(const item of await task)values.set(account+'|'+item.itemId,item);}}
  catch{if(progressKey)this.rankingProgress.get(progressKey)!.status='FAILED';throw new ServiceUnavailableException('Não foi possível concluir a consulta de vendas de todos os anúncios. O ranking não foi aplicado; tente novamente.');}
  if(progressKey)this.rankingProgress.get(progressKey)!.status='COMPLETE';
  return {items:listings.map(row=>values.get(row.marketplaceAccountId+'|'+row.itemId)??{itemId:row.itemId,soldQuantity:0,variations:[],dateFrom:from,dateTo:to})};
 }
 private async readRanking(account:string,seller:string,from:string,to:string){
  const taskKey=[account,from,to].join('|'),totalDays=(Date.parse(to)-Date.parse(from))/86400000+1;
  const store=new PersistentSnapshots(this.prisma),key=from+'|'+to,cached=await store.get(account,'LISTING_SALES_RANKING',key);
  if(cached){this.taskProgress.set(taskKey,{completed:totalDays,total:totalDays});return (cached.payload as any).items;}
  if(this.taskProgress.size>1000)for(const [key,value] of this.taskProgress)if(value.completed===value.total)this.taskProgress.delete(key);
  this.taskProgress.set(taskKey,{completed:0,total:totalDays});
  let api=this.apis.get(account);if(!api){api=new FinanceApi(force=>this.auth.getValidAccessToken(account,!!force));this.apis.set(account,api);}
  const days:string[]=[];for(let time=Date.parse(from);time<=Date.parse(to);time+=86400000)days.push(new Date(time).toISOString().slice(0,10));
  const metrics=new Map<string,{itemId:string;soldQuantity:number;variations:Map<string,number>}>(),seen=new Set<string>();let cursor=0;
  // Daily windows avoid the provider's 10,000-order limit for an entire month.
  await Promise.all(Array.from({length:2},async()=>{while(cursor<days.length){const day=days[cursor++],start=day+'T00:00:00.000-03:00',end=new Date(Date.parse(day)+86400000).toISOString().slice(0,10)+'T00:00:00.000-03:00';let offset=0,total:number|undefined;
   do{const page=await api!.get('/orders/search',{seller,'order.status':'paid','order.date_created.from':start,'order.date_created.to':end,offset,limit:50,sort:'date_asc'});
    if(!Array.isArray(page.results)||!Number.isSafeInteger(page.paging?.total)||page.paging.total<0||total!==undefined&&total!==page.paging.total)throw Error('Incomplete orders');total=page.paging.total;
    if(!page.results.length&&offset<total!)throw Error('Incomplete page');
    for(const order of page.results){if(String(order.seller?.id)!==seller||!order.id||!Array.isArray(order.order_items)||!Number.isFinite(Date.parse(order.date_created)))throw Error('Invalid order');
     const time=Date.parse(order.date_created);if(time<Date.parse(start)||time>=Date.parse(end)||order.status!=='paid')continue;
     if(seen.has(String(order.id)))throw Error('Duplicate order');seen.add(String(order.id));
     for(const line of order.order_items){if(!/^MLB\d+$/.test(line.item?.id??'')||!Number.isSafeInteger(line.quantity)||line.quantity<=0)throw Error('Invalid order item');
      const metric=metrics.get(line.item.id)??{itemId:line.item.id,soldQuantity:0,variations:new Map<string,number>()};metric.soldQuantity+=line.quantity;const variation=line.item.variation_id==null?'':String(line.item.variation_id);metric.variations.set(variation,(metric.variations.get(variation)??0)+line.quantity);metrics.set(line.item.id,metric);
     }
    }offset+=page.results.length;if(offset>=10000&&offset<total!)throw Error('Daily order limit');
   }while(offset<total!);
   this.taskProgress.get(taskKey)!.completed++;
  }}));
  const checkedAt=new Date().toISOString(),items=[...metrics.values()].map(metric=>({...metric,variations:[...metric.variations].map(([variationId,soldQuantity])=>({variationId,soldQuantity})),dateFrom:from,dateTo:to,checkedAt}));
  await store.put(account,'LISTING_SALES_RANKING',key,{items,checkedAt},new Date(),5*60_000);return items;
 }
 async find(accountId:string,requested:string[],from:string,to:string){
  const valid=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date??'')&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  if(!valid(from)||!valid(to)||from>to||to>today||(Date.parse(to)-Date.parse(from))/86400000>=150)throw new BadRequestException('Selecione um período válido de até 150 dias.');
  const selected=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,active:true},select:{id:true,businessKey:true,marketplace:true}});
  if(!selected)throw new BadRequestException('Selecione uma conta válida.');
  const ids=[...new Set(requested)];
  const listings=await this.prisma.marketplaceListing.findMany({where:{itemId:{in:ids},...(selected.marketplace==='BLING'?{marketplaceAccount:{businessKey:selected.businessKey,marketplace:'MERCADO_LIVRE'}}:{marketplaceAccountId:selected.id})},select:{itemId:true,marketplaceAccountId:true,marketplaceAccount:{select:{sellerId:true}}}});
  if(ids.some(id=>!listings.some(row=>row.itemId===id)))throw new ForbiddenException('Anúncio fora da conta selecionada.');
  const items:any[]=[];let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{while(cursor<listings.length){const row=listings[cursor++],key=[row.marketplaceAccountId,row.itemId,from,to].join('|');let task=this.pending.get(key);
   if(!task){task=this.read(row.marketplaceAccountId,String(row.marketplaceAccount.sellerId),row.itemId,from,to).finally(()=>this.pending.delete(key));this.pending.set(key,task);}
   try{items.push(await task);}catch{items.push({itemId:row.itemId,soldQuantity:null,variations:[],dateFrom:from,dateTo:to});}
  }}));return {items};
 }
 private async read(account:string,seller:string,itemId:string,from:string,to:string){
  const key=[itemId,from,to].join('|'),store=new PersistentSnapshots(this.prisma),cached=await store.get(account,'LISTING_PERIOD_SALES',key);
  if(cached)return cached.payload;
  let api=this.apis.get(account);if(!api){api=new FinanceApi(force=>this.auth.getValidAccessToken(account,!!force));this.apis.set(account,api);}
  const start=from+'T00:00:00.000-03:00',nextDay=new Date(Date.parse(to)+86400000).toISOString().slice(0,10),end=nextDay+'T00:00:00.000-03:00';
  const variations=new Map<string,number>(),seen=new Set<string>();let offset=0,total:number|undefined,soldQuantity=0;
  do{
   const page=await api.get('/orders/search',{seller,item:itemId,'order.status':'paid','order.date_created.from':start,'order.date_created.to':end,offset,limit:50,sort:'date_asc'});
   if(!Array.isArray(page.results)||!Number.isSafeInteger(page.paging?.total)||page.paging.total<0||total!==undefined&&total!==page.paging.total)throw Error('Consulta incompleta');
   total=page.paging.total;
   if(!page.results.length&&offset<total!)throw Error('Página de pedidos incompleta');
   for(const order of page.results){
    if(String(order.seller?.id)!==seller||!order.id||!Array.isArray(order.order_items)||!Number.isFinite(Date.parse(order.date_created)))throw Error('Pedido não confirmado');
    if(seen.has(String(order.id)))throw Error('Paginação de pedidos duplicada');seen.add(String(order.id));
    if(order.status!=='paid'||Date.parse(order.date_created)<Date.parse(start)||Date.parse(order.date_created)>=Date.parse(end))continue;
    for(const line of order.order_items){if(line.item?.id!==itemId)continue;if(!Number.isSafeInteger(line.quantity)||line.quantity<=0)throw Error('Quantidade inválida');
     soldQuantity+=line.quantity;const id=line.item.variation_id==null?'':String(line.item.variation_id);variations.set(id,(variations.get(id)??0)+line.quantity);
    }
   }
   offset+=page.results.length;
   if(offset>=10000&&offset<total!)throw Error('Limite de paginação');
  }while(offset<total!);
  const value={itemId,soldQuantity,variations:[...variations].map(([variationId,quantity])=>({variationId,soldQuantity:quantity})),dateFrom:from,dateTo:to,checkedAt:new Date().toISOString()};
  await store.put(account,'LISTING_PERIOD_SALES',key,value,new Date(),5*60_000);return value;
 }
}
