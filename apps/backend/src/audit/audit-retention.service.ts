import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_LOCK, ISSUE_RETENTION_DAYS } from './audit-issue-state';

export function issueRetentionCutoff(now: Date): Date { return new Date(now.getTime()-ISSUE_RETENTION_DAYS*86400000); }
@Injectable()
export class AuditRetentionService implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger(AuditRetentionService.name);
  private initial?:ReturnType<typeof setTimeout>;
  private timer?:ReturnType<typeof setInterval>;
  private busy=false;
  constructor(private readonly prisma:PrismaService){}
  onModuleInit(){
    this.initial=setTimeout(()=>void this.tick(),30000);this.initial.unref();
    this.timer=setInterval(()=>void this.tick(),86400000);this.timer.unref();
  }
  onModuleDestroy(){if(this.initial)clearTimeout(this.initial);if(this.timer)clearInterval(this.timer);}
  async cleanup(now=new Date()){
    let removed=0;
    const cutoff=issueRetentionCutoff(now);
    // Bounded batches avoid keeping a large write transaction open.
    for(let batch=0;batch<20;batch++){
      const count=await this.prisma.$transaction(async tx=>{
        const [lock]=await tx.$queryRaw<Array<{locked:boolean}>>`SELECT pg_try_advisory_xact_lock(${AUDIT_LOCK}::bigint) AS locked`;
        if(!lock.locked)return 0;
        return tx.$executeRaw`WITH expired AS (
          SELECT id FROM "AuditIssue" WHERE resolved=true AND "resolvedAt" < ${cutoff}
          ORDER BY "resolvedAt",id LIMIT 5000 FOR UPDATE SKIP LOCKED
        ) DELETE FROM "AuditIssue" a USING expired e WHERE a.id=e.id AND a.resolved=true AND a."resolvedAt" < ${cutoff}`;
      });
      removed+=count;if(count<5000)break;
    }
    return {removed,retentionDays:ISSUE_RETENTION_DAYS};
  }
  private async tick(){
    if(this.busy)return;this.busy=true;
    try{const result=await this.cleanup();if(result.removed)this.logger.log(`Expired resolved issues removed=${result.removed}`);}
    catch{this.logger.error('Audit issue retention failed; pending issues were preserved.');}
    finally{this.busy=false;}
  }
}
