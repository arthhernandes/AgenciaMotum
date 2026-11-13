import {BadRequestException,Injectable,Logger,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {Prisma,SyncType} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service';
import {BlingSyncService} from '../bling/synchronization/bling-sync.service';
import {MercadoLivreSyncService} from '../mercadolivre/synchronization/mercadolivre-sync.service';
import {DAILY_SYNC_ZONE,localSyncParts,nextDailySync} from './daily-sync-time';

type Step={accountId:string;business:string;source:'BLING'|'MERCADO_LIVRE';status:'PENDING'|'RUNNING'|'SUCCESS'|'PARTIAL'|'FAILED'|'SKIPPED';executionId?:string;message?:string};
type Run={day:string;status:'RUNNING'|'SUCCESS'|'PARTIAL';steps:Step[]};
const CONFIG='daily-sync-config';const ACTION='DAILY_SYNC_RUN';
@Injectable()
export class DailySyncService implements OnModuleInit,OnModuleDestroy{
 private readonly logger=new Logger(DailySyncService.name);private timer?:ReturnType<typeof setInterval>;private busy=false;
 constructor(private readonly prisma:PrismaService,private readonly bling:BlingSyncService,private readonly ml:MercadoLivreSyncService){}
 async onModuleInit(){await this.configuration();this.timer=setInterval(()=>void this.tick().catch(()=>this.logger.error('Não foi possível processar o agendamento diário.')),30000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private configuration(){return this.prisma.auditLog.upsert({where:{id:CONFIG},create:{id:CONFIG,action:'DAILY_SYNC_CONFIG',entityType:'SyncSchedule',entityId:CONFIG,after:{enabled:true,hour:6,timeZone:DAILY_SYNC_ZONE,nextRunAt:nextDailySync(new Date()).toISOString()}},update:{}});}
 async status(){const config=await this.configuration();const latest=await this.prisma.auditLog.findFirst({where:{action:ACTION},orderBy:{createdAt:'desc'}});return {...(config.after as object),latest:latest?{id:latest.id,createdAt:latest.createdAt,...(latest.after as object)}:null};}
 async reports(accountId:string){
  const account=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:'BLING'},select:{businessKey:true}});
  if(!account)throw new BadRequestException('Selecione uma conta Bling para consultar o relatório.');
  const records=await this.prisma.auditLog.findMany({where:{action:ACTION},orderBy:{createdAt:'desc'},take:30});
  const scoped=records.map(record=>({record,steps:((record.after as unknown as Run).steps??[]).filter(step=>step.business===account.businessKey)})).filter(row=>row.steps.length);
  const ids=scoped.flatMap(row=>row.steps.flatMap(step=>step.executionId?[step.executionId]:[]));
  const executions=await this.prisma.syncExecution.findMany({where:{id:{in:ids},marketplaceAccount:{businessKey:account.businessKey}}});
  return scoped.map(({record,steps})=>{
   const rows=steps.map(step=>{
    const execution=executions.find(item=>item.id===step.executionId);
    const details=execution?.errorDetails as any;
    const entries=Array.isArray(details)?details:Array.isArray(details?.errors)?details.errors:details?.message?[{message:details.message}]:[];
    const messages=entries.slice(0,50).map((entry:any)=>({reference:String(entry.productId??entry.itemId??entry.sku??''),message:typeof entry.message==='string'&&!/bearer|access_token|refresh_token|client_secret|APP_USR/i.test(entry.message)?entry.message.slice(0,500):'Não foi possível concluir este item. Confira a conexão e o cadastro.'}));
    return {accountId:step.accountId,source:step.source,status:execution?.status??step.status,message:step.message??'',executionId:execution?.id??null,processed:execution?.itemsProcessed??0,created:execution?.itemsCreated??0,updated:execution?.itemsUpdated??0,errors:execution?.errors??0,startedAt:execution?.startedAt??null,finishedAt:execution?.finishedAt??null,errorMessages:messages};
   });
   const status=rows.some(row=>['PENDING','RUNNING','PAUSED'].includes(row.status))?'RUNNING':rows.every(row=>row.status==='SUCCESS')?'SUCCESS':'PARTIAL';
   return {id:record.id,day:(record.after as any).day,status,steps:rows,processed:rows.reduce((sum,row)=>sum+row.processed,0),errors:rows.reduce((sum,row)=>sum+row.errors,0)};
  });
 }
 async tick(now=new Date()){
  if(this.busy)return;this.busy=true;
  try{await this.prisma.$transaction(async tx=>{
   const lock=await tx.$queryRaw<Array<{locked:boolean}>>`SELECT pg_try_advisory_xact_lock(60102026) AS locked`;
   if(!lock[0]?.locked)return;
   const config=await this.configuration();const settings=config.after as any;if(!settings.enabled)return;
   let record=await this.prisma.auditLog.findFirst({where:{action:ACTION,after:{path:['status'],equals:'RUNNING'}},orderBy:{createdAt:'asc'}});
   if(!record){
    if(now.getTime()<Date.parse(settings.nextRunAt))return;
    const day=localSyncParts(now).day;
    const accounts=await this.prisma.marketplaceAccount.findMany({where:{active:true,marketplace:{in:['BLING','MERCADO_LIVRE']},OR:[{accessToken:{not:null}},{refreshToken:{not:null}}]},orderBy:{updatedAt:'desc'},select:{id:true,businessKey:true,marketplace:true}});
    const seen=new Set<string>();const selected=accounts.filter(account=>{if(account.marketplace!=='BLING')return true;if(seen.has(account.businessKey))return false;seen.add(account.businessKey);return true;});
    selected.sort((a,b)=>{const rank=(account:typeof a)=>account.marketplace==='BLING'?0:1;return rank(a)-rank(b)||a.id.localeCompare(b.id);});
    const run:Run={day,status:'RUNNING',steps:selected.map(account=>({accountId:account.id,business:account.businessKey,source:account.marketplace as Step['source'],status:'PENDING'}))};
    record=await this.prisma.auditLog.upsert({where:{id:`daily-sync:${day}`},create:{id:`daily-sync:${day}`,action:ACTION,entityType:'SyncSchedule',entityId:day,after:run as unknown as Prisma.InputJsonValue},update:{}});
    await this.prisma.auditLog.update({where:{id:CONFIG},data:{after:{...settings,nextRunAt:nextDailySync(now).toISOString()}}});
   }
   const run=structuredClone(record.after) as unknown as Run;if(run.status!=='RUNNING')return;
   const step=run.steps.find(item=>['PENDING','RUNNING'].includes(item.status));
   if(step?.executionId){
    const execution=await this.prisma.syncExecution.findUnique({where:{id:step.executionId}});
    if(!execution){step.status='FAILED';step.message='Execução não encontrada. Confira o histórico.';}
    else if(['PENDING','RUNNING','PAUSED'].includes(execution.status))return;
    else{step.status=execution.status==='SUCCESS'?'SUCCESS':execution.status==='PARTIAL'?'PARTIAL':'FAILED';step.message=execution.status==='SUCCESS'?'Sincronização concluída.':'Confira os detalhes da execução no histórico.';}
   }else if(step){
    // A persisted execution identity prevents replay after a restart between enqueue and checkpoint.
    const previous=await this.prisma.syncExecution.findFirst({where:{marketplaceAccountId:step.accountId,type:SyncType.FULL_SYNC,createdAt:{gte:record.createdAt}},orderBy:{createdAt:'asc'}});
    if(!previous){const active=await this.prisma.syncExecution.findFirst({where:{status:{in:['PENDING','RUNNING','PAUSED']}}});if(active)return;}
    try{const execution=previous??(step.source==='BLING'?await this.bling.sync(SyncType.FULL_SYNC,step.accountId):await this.ml.startBackground(step.accountId,SyncType.FULL_SYNC));step.executionId=execution.id;step.status='RUNNING';}
    catch{step.status='FAILED';step.message='Não foi possível iniciar. Confira a conexão da conta e o histórico.';}
   }
   if(!run.steps.some(item=>['PENDING','RUNNING'].includes(item.status)))run.status=run.steps.every(item=>item.status==='SUCCESS')?'SUCCESS':'PARTIAL';
   await this.prisma.auditLog.update({where:{id:record.id},data:{after:run as unknown as Prisma.InputJsonValue}});
  },{timeout:30000});}finally{this.busy=false;}
 }
}
