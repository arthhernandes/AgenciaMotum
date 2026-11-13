require('dotenv').config({quiet:true});const assert=require('node:assert/strict');const {PrismaClient}=require('@prisma/client');const {AuditRetentionService}=require('../apps/backend/dist/src/audit/audit-retention.service');const p=new PrismaClient();
(async()=>{await p.$transaction(async tx=>{
 await tx.$executeRawUnsafe('CREATE TEMP TABLE "AuditIssue" (id text PRIMARY KEY,resolved boolean NOT NULL,"resolvedAt" timestamp(3)) ON COMMIT DROP');
 await tx.$executeRawUnsafe('SET LOCAL search_path TO pg_temp,public');
 const now=new Date('2026-11-12T15:00:00Z');
 await tx.$executeRawUnsafe(`INSERT INTO "AuditIssue" VALUES ('expired',true,'2026-08-13 15:00:00'),('boundary',true,'2026-08-14 15:00:00'),('recent',true,'2026-08-15 15:00:00'),('pending',false,'2026-01-01'),('undated',true,NULL)`);
 const service=new AuditRetentionService({$transaction:callback=>callback(tx)});
 assert.equal((await service.cleanup(now)).removed,1);
 const rows=await tx.$queryRawUnsafe('SELECT id FROM "AuditIssue" ORDER BY id');assert.deepEqual(rows.map(row=>row.id),['boundary','pending','recent','undated']);
 },{timeout:30000});console.log('PASS: real PostgreSQL retention boundary, pending and undated protection; temporary table only.');})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>p.$disconnect());
