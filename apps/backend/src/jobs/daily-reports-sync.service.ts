import {Injectable,Logger,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {PrismaService} from '../prisma/prisma.service';
import {localSyncParts} from './daily-sync-time';

/** Report screens never import. A single background pipeline follows the daily catalog sync. */
@Injectable()
export class DailyReportsSyncService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;private busy=false;
  private logger=new Logger(DailyReportsSyncService.name);
  constructor(private readonly prisma:PrismaService){}
  onModuleInit(){this.timer=setInterval(()=>void this.tick().catch(()=>this.logger.error('Falha no agendamento dos dados dos relatórios.')),30000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async tick(now=new Date()){
    if(this.busy)return;this.busy=true;
    try {
      const day=localSyncParts(now).day,id=`daily-reports:${day}`;
      const config=await this.prisma.auditLog.findUnique({where:{id:'daily-sync-config'}});
      if(!(config?.after as any)?.enabled)return;
      await this.recoverInterrupted();
      const catalog=await this.prisma.auditLog.findUnique({where:{id:`daily-sync:${day}`}});
      if(!['SUCCESS','PARTIAL'].includes((catalog?.after as any)?.status))return;
      let root=process.cwd();while(!existsSync(join(root,'scripts','sync-report-data.cjs'))){const parent=dirname(root);if(parent===root)throw Error('Importador dos relatórios não encontrado.');root=parent;}
      const claimed=await this.prisma.$transaction(async tx=>{
        const lock=await tx.$queryRaw<Array<{locked:boolean}>>`SELECT pg_try_advisory_xact_lock(60102027) AS locked`;
        if(!lock[0]?.locked||await tx.auditLog.findUnique({where:{id}}))return false;
        // Preserve the initial load and avoid simultaneous imports into the same archives.
        const active=await tx.auditLog.findFirst({where:{action:{in:['ORDER_HISTORY_IMPORT','ORDER_HISTORY_ENRICHMENT','ADVERTISING_VISITS_IMPORT','DAILY_REPORTS_SYNC']},after:{path:['status'],equals:'RUNNING'}}});
        if(active)return false;
        await tx.auditLog.create({data:{id,action:'DAILY_REPORTS_SYNC',entityType:'SyncSchedule',entityId:day,after:{day,status:'RUNNING',stage:'STARTING',startedAt:now.toISOString()}}});return true;
      });
      if(!claimed)return;
      const child=spawn(process.execPath,[join(root,'scripts','sync-report-data.cjs'),'--job',id],{cwd:root,windowsHide:true,stdio:'ignore'});
      const failed=()=>void this.prisma.auditLog.updateMany({where:{id,after:{path:['status'],equals:'RUNNING'}},data:{after:{day,status:'FAILED',finishedAt:new Date().toISOString(),message:'A sincronização dos relatórios foi interrompida; os dados já salvos foram preservados.'}}}).catch(()=>this.logger.error('Falha ao registrar interrupção dos relatórios.'));
      child.once('error',failed);child.once('exit',code=>{if(code!==0)failed();});child.unref();
    }finally{this.busy=false;}
  }
  private async recoverInterrupted(){
    const running=await this.prisma.auditLog.findMany({where:{action:{in:['ORDER_HISTORY_IMPORT','ORDER_HISTORY_ENRICHMENT','ADVERTISING_VISITS_IMPORT','DAILY_REPORTS_SYNC']},after:{path:['status'],equals:'RUNNING'}}});
    for(const job of running){
      const state=job.after as any;if(!Number.isInteger(state?.processId)||state.processId<=0)continue;
      try{process.kill(state.processId,0);}catch(error){
        if((error as NodeJS.ErrnoException).code!=='ESRCH')continue;
        await this.prisma.auditLog.updateMany({where:{id:job.id,after:{path:['status'],equals:'RUNNING'}},data:{after:{...state,status:'FAILED',finishedAt:new Date().toISOString(),message:'Processo interrompido. Checkpoints e dados preservados para a próxima sincronização.'}}});
      }
    }
  }
}
