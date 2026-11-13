import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';
import { FinanceApi } from '../reports/finance-api';
import { PersistentSnapshots } from '../reports/persistent-snapshots';

@Injectable()
export class ListingPricesService {
 private apis=new Map<string,FinanceApi>();
 private pending=new Map<string,Promise<any>>();
 private filterQueue:Array<()=>Promise<void>>=[];
 private filterWorkers=0;
 private filterScheduled=new Set<string>();
 private filterFailures=new Map<string,number>();
 constructor(private prisma:PrismaService,private auth:MercadoLivreAuthService){}
 async annotate(groups:any[]){
  const targets=new Map<string,{account:string;itemId:string}>();
  for(const group of groups)for(const child of group.children)targets.set(child.marketplaceAccountId+':'+child.itemId,{account:child.marketplaceAccountId,itemId:child.itemId});
  const entries=[...targets.values()];
  const records=entries.length?await this.prisma.integrationSnapshot.findMany({where:{category:'LISTING_SALE_PRICE',marketplaceAccountId:{in:[...new Set(entries.map(row=>row.account))]},key:{in:entries.map(row=>row.itemId)},expiresAt:{gt:new Date()}},select:{marketplaceAccountId:true,key:true,payload:true}}):[];
  const values=new Map<string,any>(records.map(row=>[row.marketplaceAccountId+':'+row.key,row.payload]));
  let unavailable=0,remaining=0;
  for(const [key,row] of targets){
   if(typeof values.get(key)?.promotional==='boolean')continue;
   if((this.filterFailures.get(key)??0)>Date.now()){unavailable++;continue;}
   remaining++;
   if(this.filterScheduled.has(key))continue;
   this.filterScheduled.add(key);
   this.filterQueue.push(async()=>{try{await this.read(row.account,row.itemId);this.filterFailures.delete(key);}catch{this.filterFailures.set(key,Date.now()+60000);}finally{this.filterScheduled.delete(key);}});
  }
  this.drainFilter();
  for(const group of groups){const states=group.children.map((child:any)=>values.get(child.marketplaceAccountId+':'+child.itemId)?.promotional);group.promotionStatus=states.some((value:any)=>value===true)?'with':states.every((value:any)=>value===false)?'without':'unknown';}
  return {checked:entries.length-remaining-unavailable,total:entries.length,remaining,unavailable,nextRetryMs:2000};
 }
 private drainFilter(){while(this.filterWorkers<4&&this.filterQueue.length){const task=this.filterQueue.shift()!;this.filterWorkers++;void task().finally(()=>{this.filterWorkers--;this.drainFilter();});}}
 async find(accountId:string,requested:string[]){
  const selected=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,active:true},select:{id:true,businessKey:true,marketplace:true}});
  if(!selected)throw new BadRequestException('Selecione uma conta válida.');
  const ids=[...new Set(requested)];
  const listings=await this.prisma.marketplaceListing.findMany({where:{itemId:{in:ids},...(selected.marketplace==='BLING'?{marketplaceAccount:{businessKey:selected.businessKey,marketplace:'MERCADO_LIVRE'}}:{marketplaceAccountId:selected.id})},select:{itemId:true,marketplaceAccountId:true}});
  if(ids.some(id=>!listings.some(row=>row.itemId===id)))throw new ForbiddenException('Anúncio fora da conta selecionada.');
  const items:any[]=[];let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{while(cursor<listings.length){const row=listings[cursor++],key=row.marketplaceAccountId+':'+row.itemId;
   let task=this.pending.get(key);
   if(!task){task=this.read(row.marketplaceAccountId,row.itemId).finally(()=>this.pending.delete(key));this.pending.set(key,task);}
   try{items.push(await task);}catch{items.push({itemId:row.itemId,amount:null,promotional:null});}
  }}));return {items};
 }
 private async read(account:string,itemId:string){
  const store=new PersistentSnapshots(this.prisma),cached=await store.get(account,'LISTING_SALE_PRICE',itemId);
  if(cached)return cached.payload;
  let api=this.apis.get(account);if(!api){api=new FinanceApi(force=>this.auth.getValidAccessToken(account,!!force));this.apis.set(account,api);}
  const sale=await api.get('/items/'+itemId+'/sale_price',{context:'channel_marketplace'});
  if(sale.currency_id!=='BRL'||typeof sale.amount!=='number'||!Number.isFinite(sale.amount)||sale.amount<=0)throw Error('Preço não confirmado');
  const regular=typeof sale.regular_amount==='number'&&Number.isFinite(sale.regular_amount)&&sale.regular_amount>0?sale.regular_amount:null;
  const value={itemId,amount:sale.amount,regularAmount:regular,promotional:regular!==null&&regular>sale.amount,checkedAt:new Date().toISOString()};
  await store.put(account,'LISTING_SALE_PRICE',itemId,value,new Date(),5*60_000);return value;
 }
}
