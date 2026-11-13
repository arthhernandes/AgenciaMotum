require('dotenv').config({quiet:true});
const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const {PrismaClient}=require('@prisma/client');const prisma=new PrismaClient();
const fields='type,"productId","productVariantId","listingId","listingVariantId","marketplaceAccountId"';
const identified='"productId" IS NOT NULL OR "productVariantId" IS NOT NULL OR "listingId" IS NOT NULL OR "listingVariantId" IS NOT NULL OR "marketplaceAccountId" IS NOT NULL';
async function stats(db=prisma){const [row]=await db.$queryRawUnsafe(`SELECT count(*)::int AS total,count(*) FILTER(WHERE NOT resolved)::int AS open,count(*) FILTER(WHERE resolved)::int AS resolved,pg_total_relation_size('public."AuditIssue"')::text AS bytes FROM "AuditIssue"`);return row;}
async function pendingGroups(db){const [row]=await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM (SELECT ${fields} FROM "AuditIssue" WHERE NOT resolved GROUP BY ${fields}) a`);return row.count;}
async function main(){
 const before=await stats();console.log(JSON.stringify({before}));if(!process.argv.includes('--apply'))return;
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');const dir=path.resolve('artifacts/backups');fs.mkdirSync(dir,{recursive:true});const backup=path.join(dir,'audit-issues-'+stamp+'.dump');
 const url=new URL(process.env.DATABASE_URL);const bin='C:/Program Files/PostgreSQL/17/bin';
 const env={...process.env,PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:url.searchParams.get('sslmode')||'prefer'};
 const connection=['--host',url.hostname,'--port',url.port||'5432','--username',decodeURIComponent(url.username),'--dbname',decodeURIComponent(url.pathname.slice(1)),'--no-password'];
 const dump=spawnSync(path.join(bin,'pg_dump.exe'),[...connection,'--format=custom','--table=public."AuditIssue"','--file',backup],{env,encoding:'utf8',windowsHide:true});
 if(dump.status!==0||!fs.existsSync(backup)||fs.statSync(backup).size===0)throw Error('Backup failed; no cleanup was performed. '+(dump.stderr||''));
 const verify=spawnSync(path.join(bin,'pg_restore.exe'),['--list',backup],{encoding:'utf8',windowsHide:true});
 if(verify.status!==0||!verify.stdout.includes('AuditIssue'))throw Error('Backup verification failed; no cleanup was performed.');
 console.log(JSON.stringify({backup,backupBytes:fs.statSync(backup).size,verified:true}));
 const cleanup=await prisma.$transaction(async tx=>{
  const [lock]=await tx.$queryRawUnsafe('SELECT pg_try_advisory_xact_lock(71261112::bigint) AS locked');if(!lock.locked)throw Error('Audit in progress. Retry after it finishes.');
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
  await tx.$executeRawUnsafe('LOCK TABLE "AuditIssue" IN SHARE ROW EXCLUSIVE MODE');
  const pendingBefore=await pendingGroups(tx);
  const duplicatesRemoved=await tx.$executeRawUnsafe(`WITH ranked AS (SELECT id,row_number() OVER(PARTITION BY ${fields} ORDER BY resolved ASC,"updatedAt" DESC,id DESC) AS rn FROM "AuditIssue" WHERE ${identified}) DELETE FROM "AuditIssue" a USING ranked r WHERE a.id=r.id AND r.rn>1`);
  const cutoff=new Date(Date.now()-90*86400000);
  const expiredRemoved=await tx.auditIssue.deleteMany({where:{resolved:true,resolvedAt:{lt:cutoff}}});
  const after=await stats(tx);const pendingAfter=await pendingGroups(tx);if(pendingAfter!==pendingBefore)throw Error('Pending issue identity check failed; rolling back.');
  const summary={before,after,duplicatesRemoved,expiredRemoved:expiredRemoved.count,pendingBefore,pendingAfter,backup};
  await tx.auditLog.create({data:{action:'AUDIT_ISSUE_STORAGE_OPTIMIZATION',entityType:'AuditIssue',entityId:'retention-90-days',before,after:summary}});
  return summary;
 },{timeout:120000,maxWait:5000});
 console.log(JSON.stringify({cleanup}));
 const vacuum=spawnSync(path.join(bin,'psql.exe'),[...connection,'-X','-v','ON_ERROR_STOP=1','-c','VACUUM (FULL, ANALYZE) public."AuditIssue"'],{env:{...env,PGOPTIONS:'-c lock_timeout=5s -c statement_timeout=120s'},encoding:'utf8',windowsHide:true});
 const final=await stats();const result={...cleanup,final,compacted:vacuum.status===0};fs.writeFileSync(backup+'.summary.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({final,compacted:result.compacted,summaryFile:backup+'.summary.json'}));
 if(vacuum.status!==0){console.error('Logical cleanup succeeded; physical compaction was deferred: '+vacuum.stderr);process.exitCode=2;}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
