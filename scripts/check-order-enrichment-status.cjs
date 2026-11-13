require('dotenv').config({quiet:true});const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
async function main(){const job=await p.auditLog.findFirst({where:{action:'ORDER_HISTORY_ENRICHMENT'},orderBy:{createdAt:'desc'},select:{id:true,after:true,createdAt:true}});console.log(JSON.stringify(job??{status:'NOT_STARTED'}));}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
