require('dotenv').config({quiet:true});
const fs=require('node:fs');
const {PrismaClient}=require('@prisma/client');
const {HttpService}=require('@nestjs/axios');
const {ConfigService}=require('@nestjs/config');
const {MercadoLivreAuthService}=require('../apps/backend/dist/src/mercadolivre/auth/mercadolivre-auth.service');
const {MercadoLivreClient}=require('../apps/backend/dist/src/mercadolivre/mercadolivre.client');
const {ChatMarketplaceService}=require('../apps/backend/dist/src/chat/chat-marketplace.service');
const prisma=new PrismaClient(),http=new HttpService(),client=new MercadoLivreClient(http);
const auth=new MercadoLivreAuthService(http,new ConfigService(process.env),prisma);
const market=new ChatMarketplaceService(prisma,{},{});
const report={startedAt:new Date().toISOString(),remoteReadOnly:true,accounts:[]};
const file='artifacts/finalized-listings-audit-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
fs.mkdirSync('artifacts',{recursive:true});
const checkpoint=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
async function main(){
 const accounts=await prisma.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true},select:{id:true,businessKey:true,sellerId:true}});
 for(const account of accounts){
  const result={accountId:account.id,business:account.businessKey,totalLocal:0,remoteClosed:0,candidates:0,checked:0,finalized:[],corrected:[],stillUnderReview:0,stillInactive:0,errors:[]};report.accounts.push(result);checkpoint();
  try{
   const token=await auth.getValidAccessToken(account.id);
   const local=await prisma.marketplaceListing.findMany({where:{marketplaceAccountId:account.id},select:{id:true,itemId:true,status:true,title:true,rawData:true}});result.totalLocal=local.length;
   const remoteClosed=new Set();let scroll;
   do{
    const page=await client.searchSellerItems(token,account.sellerId,{status:'closed',search_type:'scan',limit:100,...(scroll?{scroll_id:scroll}:{})});
    if(!Array.isArray(page.results)||page.seller_id&&String(page.seller_id)!==account.sellerId)throw Error('Busca de finalizados inválida ou de outro vendedor.');
    const before=remoteClosed.size;for(const id of page.results)remoteClosed.add(id);
    if(!page.results.length||remoteClosed.size>=page.paging.total)break;
    if(!page.scroll_id||remoteClosed.size===before)throw Error('Busca de finalizados incompleta.');scroll=page.scroll_id;
   }while(true);
   result.remoteClosed=remoteClosed.size;
   const candidates=local.filter(row=>remoteClosed.has(row.itemId)||['under_review','inactive','closed'].includes(row.status)||row.rawData?.sub_status?.includes('deleted'));
   result.candidates=candidates.length;console.log(JSON.stringify({business:account.businessKey,totalLocal:local.length,remoteClosed:remoteClosed.size,candidates:candidates.length}));checkpoint();
   let cursor=0;
   await Promise.all(Array.from({length:3},async()=>{while(cursor<candidates.length){
    const row=candidates[cursor++];
    try{
     const item=await client.getItem(token,row.itemId);
     if(item.id!==row.itemId||String(item.seller_id)!==account.sellerId)throw Error('ID ou vendedor não confirmado.');
     const finalized=item.status==='closed'||item.sub_status?.includes('deleted')||item.sub_status?.includes('forbidden');
     const oldFinalized=row.status==='closed'||row.rawData?.sub_status?.includes('deleted')||row.rawData?.sub_status?.includes('forbidden');
     if(row.status!==item.status||!!oldFinalized!==!!finalized){
      await prisma.auditLog.create({data:{action:'FINALIZED_LISTING_AUDIT',entityType:'MarketplaceListing',entityId:row.id,before:{status:row.status,subStatus:row.rawData?.sub_status??[]},after:{status:item.status,subStatus:item.sub_status??[],remoteReadOnly:true}}});
      result.corrected.push({itemId:row.itemId,title:row.title,before:row.status,after:item.status,finalized:!!finalized});
     }
     await market.saveLocal(account,item);
     if(finalized)result.finalized.push({itemId:item.id,title:item.title,status:item.status,subStatus:item.sub_status??[],familyId:item.family_id??null,previousStatus:row.status,newlyIdentified:!oldFinalized});
     else if(item.status==='under_review')result.stillUnderReview++;
     else if(item.status==='inactive')result.stillInactive++;
    }catch(error){result.errors.push({itemId:row.itemId,status:error.response?.status??null,message:error.response?'Leitura não confirmada; estado local preservado.':error.message});}
    result.checked++;if(result.checked%25===0||result.checked===candidates.length){checkpoint();console.log(JSON.stringify({business:account.businessKey,checked:result.checked,total:result.candidates,finalized:result.finalized.length,newlyFinalized:result.finalized.filter(row=>row.newlyIdentified).length,errors:result.errors.length}));}
   }}));
  }catch(error){result.errors.push({stage:'account',status:error.response?.status??null,message:error.response?'Falha na consulta da conta.':error.message});}
  checkpoint();
 }
 report.finishedAt=new Date().toISOString();checkpoint();
 console.log(JSON.stringify({report:file,summary:report.accounts.map(row=>({business:row.business,checked:row.checked,finalized:row.finalized.length,newlyFinalized:row.finalized.filter(item=>item.newlyIdentified).length,corrected:row.corrected.length,errors:row.errors.length}))}));
}
main().catch(error=>{checkpoint();console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
