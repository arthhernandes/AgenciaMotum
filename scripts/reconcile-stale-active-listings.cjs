require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const {HttpService}=require('@nestjs/axios');
const {ConfigService}=require('@nestjs/config');
const {MercadoLivreAuthService}=require('../apps/backend/dist/src/mercadolivre/auth/mercadolivre-auth.service');
const {MercadoLivreClient}=require('../apps/backend/dist/src/mercadolivre/mercadolivre.client');
const {ChatMarketplaceService}=require('../apps/backend/dist/src/chat/chat-marketplace.service');
const prisma=new PrismaClient();
async function main(){
 const http=new HttpService(),auth=new MercadoLivreAuthService(http,new ConfigService(process.env),prisma),client=new MercadoLivreClient(http),market=new ChatMarketplaceService(prisma,{},{});
 const report=[];
 const accounts=await prisma.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true}});
 for(const account of accounts){
  const last=await prisma.syncExecution.findFirst({where:{marketplaceAccountId:account.id,source:'MERCADO_LIVRE',status:'SUCCESS'},orderBy:{createdAt:'desc'}});
  if(!last?.startedAt){report.push({business:account.businessKey,error:'Sem sincronização completa bem-sucedida para comparação.'});continue;}
  const candidates=await prisma.marketplaceListing.findMany({where:{marketplaceAccountId:account.id,status:'active',OR:[{lastSyncedAt:{lt:last.startedAt}},{lastSyncedAt:null}]},select:{id:true,itemId:true,status:true,lastSyncedAt:true,title:true}});
  const result={business:account.businessKey,checked:candidates.length,corrected:[],stillActive:[],errors:[]};
  if(candidates.length){
   const token=await auth.getValidAccessToken(account.id);
   for(let offset=0;offset<candidates.length;offset+=20){
    const chunk=candidates.slice(offset,offset+20),responses=await client.getItems(token,chunk.map(row=>row.itemId));
    for(const row of chunk){
     const response=responses.find(value=>value.body?.id===row.itemId);
     if(response?.code!==200||String(response.body?.seller_id)!==account.sellerId){result.errors.push({itemId:row.itemId,status:response?.code??null,message:'Leitura ou vendedor não confirmado; registro preservado.'});continue;}
     const item=response.body;
     await market.saveLocal(account,item);
     if(item.status!=='active'||item.sub_status?.includes('deleted')){
      await prisma.auditLog.create({data:{action:'LISTING_STATUS_RECONCILED',entityType:'MarketplaceListing',entityId:row.id,before:{status:row.status,lastSyncedAt:row.lastSyncedAt?.toISOString()},after:{status:item.status,subStatus:item.sub_status??[],readOnlyMarketplace:true}}});
      result.corrected.push({itemId:row.itemId,title:row.title,status:item.status,subStatus:item.sub_status??[]});
     }else result.stillActive.push(row.itemId);
    }
   }
  }
  report.push(result);console.log(JSON.stringify(result));
 }
 return report;
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
