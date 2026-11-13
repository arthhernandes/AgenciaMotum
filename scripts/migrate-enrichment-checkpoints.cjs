require('dotenv').config({quiet:true});const {PrismaClient}=require('@prisma/client');const {PersistentSnapshots}=require('../apps/backend/dist/src/reports/persistent-snapshots');const {restoreCheckpoints}=require('./lib/enrichment-checkpoints.cjs');const p=new PrismaClient(),store=new PersistentSnapshots(p);
async function main(){let job=await p.auditLog.findUniqueOrThrow({where:{id:process.argv[2]}});if(job.action!=='ORDER_HISTORY_ENRICHMENT')throw Error('Conferência inválida');if(job.after.processId){let alive=false;try{process.kill(job.after.processId,0);alive=true;}catch(e){if(e.code!=='ESRCH')alive=true;}if(alive)throw Error('Interrompa a execução antes de migrar seus marcadores.');}
 const chain=[];while(job){chain.push(job);job=job.after.resumedFrom?await p.auditLog.findUnique({where:{id:job.after.resumedFrom}}):null;}
 const scopeId=chain.at(-1).id;
 for(const account of await p.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true}})){
  const records=await p.integrationSnapshot.findMany({where:{marketplaceAccountId:account.id,category:'ORDER_HISTORY'},orderBy:{key:'asc'},select:{id:true,key:true,payload:true}});
  const plan=await restoreCheckpoints(p,store,account,records,scopeId,chain);console.log(JSON.stringify({account:account.businessKey,total:plan.scope.length,alreadyReviewed:plan.processed,remaining:plan.targets.length,...plan.baseline}));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
