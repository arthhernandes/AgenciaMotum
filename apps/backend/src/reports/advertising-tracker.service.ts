import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';
import { FinanceApi } from './finance-api';
import { ProductAds } from './product-ads';
import { MembershipHistory, observeMemberships } from './advertising-membership';
import { marketplaceSyncEvents } from '../mercadolivre/sync-events';

@Injectable()
export class AdvertisingTrackerService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;private initial?:ReturnType<typeof setTimeout>;
  private running=new Map<string,Promise<void>>();private logger=new Logger(AdvertisingTrackerService.name);
  private onSynced=(accountId:string)=>{void this.syncAccount(accountId).catch(()=>this.logger.warn('Observação após sincronização falhou; histórico preservado.'));};
  constructor(private prisma:PrismaService,private auth:MercadoLivreAuthService){}
  onModuleInit(){marketplaceSyncEvents.on('synced',this.onSynced);this.initial=setTimeout(()=>void this.tick(),5000);this.initial.unref();this.timer=setInterval(()=>void this.tick(),15*60_000);this.timer.unref();}
  onModuleDestroy(){marketplaceSyncEvents.off('synced',this.onSynced);if(this.initial)clearTimeout(this.initial);if(this.timer)clearInterval(this.timer);}
  async history(accountId:string){
    const record=await this.prisma.integrationSnapshot.findFirst({where:{marketplaceAccountId:accountId,category:'PRODUCT_ADS_MEMBERSHIP'},select:{payload:true}});
    return record?.payload as unknown as MembershipHistory|undefined;
  }
  async tick(){
    try{const accounts=await this.prisma.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true},select:{id:true}});
      for(const account of accounts)try{await this.syncAccount(account.id);}catch{this.logger.warn('Consulta de vínculos publicitários falhou; histórico anterior preservado.');}
    }catch{this.logger.warn('Não foi possível agendar a observação da publicidade.');}
  }
  async syncAccount(accountId:string){
    const pending=this.running.get(accountId);if(pending)return pending;
    const task=this.observe(accountId).finally(()=>this.running.delete(accountId));this.running.set(accountId,task);return task;
  }
  private async observe(accountId:string){
    const account=await this.prisma.marketplaceAccount.findUniqueOrThrow({where:{id:accountId},select:{sellerId:true,active:true,marketplace:true}});
    if(!account.active||account.marketplace!=='MERCADO_LIVRE'||!/^\d+$/.test(account.sellerId??''))return;
    const category='PRODUCT_ADS_MEMBERSHIP',key='v1|'+account.sellerId;
    const identity={marketplaceAccountId:accountId,category,key};
    const old=await this.prisma.integrationSnapshot.findUnique({where:{marketplaceAccountId_category_key:identity}});
    if(old&&Date.now()-old.fetchedAt.getTime()<60_000)return;
    const api=new FinanceApi(force=>this.auth.getValidAccessToken(accountId,!!force));
    if(String((await api.get('/users/me')).id)!==account.sellerId)throw Error('Token de outro vendedor.');
    const snapshot=await new ProductAds(api,account.sellerId!).memberships();
    // Network reads happen before the transaction; failed or partial reads never close intervals.
    await this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${category+'|'+accountId}))`;
      const latest=await tx.integrationSnapshot.findUnique({where:{marketplaceAccountId_category_key:identity}}),previous=latest?.payload as unknown as MembershipHistory|undefined;
      if(previous&&previous.lastObservedAt>=snapshot.startedAt)return;
      const history=observeMemberships(previous,account.sellerId!,snapshot.members,snapshot.observedAt,snapshot.unknownIds);
      const payload=JSON.parse(JSON.stringify(history)),values={payload,fetchedAt:new Date(snapshot.observedAt),expiresAt:null};
      await tx.integrationSnapshot.upsert({where:{marketplaceAccountId_category_key:identity},create:{...identity,...values},update:values});
    },{timeout:15000});
  }
}
