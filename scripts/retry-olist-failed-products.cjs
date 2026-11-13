require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const {HttpService}=require('@nestjs/axios');
const {ConfigService}=require('@nestjs/config');
const {OlistAuthService}=require('../apps/backend/dist/src/olist/olist-auth.service');
const {OlistSyncService}=require('../apps/backend/dist/src/olist/synchronization/olist-sync.service');
const prisma=new PrismaClient();
async function main(){
 const ids=process.argv.slice(2);if(!ids.length)throw Error('Informe as execuções Olist a recuperar.');
 const http=new HttpService(),auth=new OlistAuthService(prisma,http,new ConfigService(process.env)),service=new OlistSyncService(prisma,http,{},auth);
 for(const id of ids){
  const original=await prisma.syncExecution.findUniqueOrThrow({where:{id}});
  if(original.source!=='OLIST'||!['PARTIAL','FAILED'].includes(original.status))throw Error('Execução incompatível: '+id);
  const account=await prisma.marketplaceAccount.findUniqueOrThrow({where:{id:original.marketplaceAccountId}});
  const pending=[...new Map((original.errorDetails?.errors||[]).filter(e=>e.productId).map(e=>[e.productId,e])).values()];
  const execution=await prisma.syncExecution.create({data:{source:'OLIST',type:'MANUAL_SYNC',marketplaceAccountId:account.id,status:'RUNNING',startedAt:new Date(),errorDetails:{recoveryOf:id}}});
  let processed=0,created=0,updated=0,emptyParents=0;const errors=[];
  for(const row of pending){
   try{
    const detail=await service.get('/produtos/'+row.productId,account.accessToken);
    if(String(detail.id)!==String(row.productId))throw Error('Produto retornado não corresponde ao solicitado.');
    if(detail.tipoVariacao==='P'&&Array.isArray(detail.variacoes)&&!detail.variacoes.length)emptyParents++;
    else {
     const result=await service.syncBaseProduct(account.id,account.accessToken,{id:detail.id,sku:detail.sku||detail.codigo,descricao:detail.descricao,tipoVariacao:detail.tipoVariacao});
     if(result===null)emptyParents++;else if(result)created++;else updated++;
    }
   }catch(error){errors.push({productId:row.productId,sku:row.sku,message:error.message.slice(0,1000)});}
   processed++;
   await prisma.syncExecution.update({where:{id:execution.id},data:{itemsProcessed:processed,itemsCreated:created,itemsUpdated:updated,errors:errors.length,errorDetails:{recoveryOf:id,emptyParents,errors,progress:{total:pending.length,percent:Math.floor(processed/pending.length*100),message:'Reprocessando produtos afetados'}}}});
   if(processed%10===0)console.log(JSON.stringify({account:account.businessKey,processed,total:pending.length,emptyParents,errors:errors.length}));
  }
  await prisma.syncExecution.update({where:{id:execution.id},data:{status:errors.length?'PARTIAL':'SUCCESS',finishedAt:new Date()}});
  console.log(JSON.stringify({executionId:execution.id,recoveryOf:id,account:account.businessKey,processed,created,updated,emptyParents,errors}));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
