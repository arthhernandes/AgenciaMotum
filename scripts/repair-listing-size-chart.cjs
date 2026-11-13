require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client'),{HttpService}=require('@nestjs/axios'),{ConfigService}=require('@nestjs/config');
const {MercadoLivreAuthService}=require('../apps/backend/dist/src/mercadolivre/auth/mercadolivre-auth.service');
const {MercadoLivreClient}=require('../apps/backend/dist/src/mercadolivre/mercadolivre.client');
const {ChatMarketplaceService}=require('../apps/backend/dist/src/chat/chat-marketplace.service');
const {ChatSizeChartCreationService}=require('../apps/backend/dist/src/chat/chat-size-chart-creation.service');
const {checkedChartRows}=require('../apps/backend/dist/src/chat/chat-size-charts');
const p=new PrismaClient(),h=new HttpService(),auth=new MercadoLivreAuthService(h,new ConfigService(process.env),p),c=new MercadoLivreClient(h,p),market=new ChatMarketplaceService(p,auth,c);
async function main(){
 const [accountId,reference,oldChartId]=process.argv.slice(2);if(!accountId||!/^MLB\d+$/.test(reference??'')||!/^\d+$/.test(oldChartId??''))throw Error('Informe conta Olist, MLB e ID do guia atual.');
 const user=await p.user.findUniqueOrThrow({where:{email:'admin@example.com'}}),business=await p.marketplaceAccount.findUniqueOrThrow({where:{id:accountId}});
 const source=await market.chartSource(business,reference),item=source.item;
 if(String(item.seller_id)!==source.account.sellerId||item.status!=='active'||!item.domain_id||item.attributes.find(a=>a.id==='SIZE_GRID_ID')?.value_name!==oldChartId||!item.variations?.length)throw Error('O anúncio mudou; reparo não enviado.');
 const old=await c.getSizeChart(source.token,oldChartId);
 if(String(old.seller_id)!==source.account.sellerId||!old.rows?.length)throw Error('Guia original não confirmado.');
 const previous=await p.auditLog.findFirst({where:{action:'SIZE_CHART_COMPATIBILITY_REPAIR',entityId:reference},orderBy:{createdAt:'desc'}});
 if(previous&&previous.after.status!=='FAILED')throw Error('Já existe um registro de reparo em andamento ou verificado. Confira antes de repetir.');
 const reuseChart=previous?.after?.newChartId;
 const sizes=item.variations.map(v=>v.attribute_combinations.find(a=>a.id==='SIZE')?.value_name);
 const rows=old.rows.map(row=>({size:row.attributes.find(a=>a.id==='SIZE').values[0].name,equivalentId:row.attributes.find(a=>a.id==='FILTRABLE_SIZE')?.values[0]?.id,measurements:Object.fromEntries(row.attributes.filter(a=>a.id.startsWith('GARMENT_')).map(a=>[a.id,a.values[0]?.struct?.number]))}));
 const audit=await p.auditLog.create({data:{userId:user.id,action:'SIZE_CHART_COMPATIBILITY_REPAIR',entityType:'MarketplaceListing',entityId:reference,before:{accountId,item,chart:old,resumeOf:previous?.id??null},after:{status:'PREPARING',preserveMeasurements:true}}});
 const service=new ChatSizeChartCreationService(p,market,c,h,new ConfigService(process.env));
 let newId,sent=false;
 try{
  if(reuseChart)newId=reuseChart;else{const draft=await service.prepareManual(accountId,user.id,{anuncio:reference,measureType:'CLOTHING_MEASURE',requiredSizes:sizes});const created=await service.create(draft.id,accountId,user.id,rows);newId=created.id;}
  const freshChart=await c.getSizeChart(source.token,newId),mapped=checkedChartRows(freshChart,source,sizes);
  for(const row of rows){const actual=freshChart.rows.find(r=>r.id===mapped[row.size.toUpperCase()]);for(const [field,value]of Object.entries(row.measurements)){if(actual?.attributes.find(a=>a.id===field)?.values[0]?.struct?.number!==value)throw Error('Uma medida mudou na cópia. Associação cancelada.');}}
  const fresh=await c.getItem(source.token,reference);
  const attributes=values=>(values??[]).map(a=>({id:a.id,value:a.value_id??a.values?.[0]?.id??a.value_name??a.values?.[0]?.name??null})).sort((a,b)=>a.id.localeCompare(b.id));
  const state=i=>JSON.stringify({id:i.id,seller:i.seller_id,domain:i.domain_id,category:i.category_id,price:i.price,status:i.status,title:i.title,attributes:attributes(i.attributes),pictures:i.pictures?.map(p=>p.id).sort(),variations:i.variations?.map(v=>({id:String(v.id),quantity:v.available_quantity,price:v.price,pictures:v.picture_ids?.slice().sort(),dimensions:attributes(v.attribute_combinations),attributes:attributes(v.attributes)})).sort((a,b)=>a.id.localeCompare(b.id))});
  if(state(fresh)!==state(item))throw Error('Os dados materiais do anúncio mudaram durante a preparação. Associação cancelada.');
  const body={attributes:market.mergeAttributes(fresh.attributes,[{id:'SIZE_GRID_ID',value_name:newId}]),variations:fresh.variations.map(v=>({id:v.id,attributes:market.mergeAttributes(v.attributes,[{id:'SIZE_GRID_ROW_ID',value_name:mapped[v.attribute_combinations.find(a=>a.id==='SIZE').value_name.toUpperCase()]}])}))};
  await p.auditLog.update({where:{id:audit.id},data:{after:{status:'SENDING',newChartId:newId,body,preserveMeasurements:true}}});sent=true;
  let failure;try{await c.updateItem(source.token,reference,body);}catch(e){failure=e;}
  const after=await c.getItem(source.token,reference);
  if(after.attributes.find(a=>a.id==='SIZE_GRID_ID')?.value_name!==newId)throw failure??Error('Nova tabela não confirmada.');
  if(after.price!==item.price||after.status!==item.status||after.variations.length!==item.variations.length)throw Error('Conferência das condições do anúncio falhou.');
  for(const variant of after.variations){const before=item.variations.find(v=>String(v.id)===String(variant.id));if(!before||before.available_quantity!==variant.available_quantity||JSON.stringify(attributes(before.attribute_combinations))!==JSON.stringify(attributes(variant.attribute_combinations))||before.attributes.find(a=>a.id==='SELLER_SKU')?.value_name!==variant.attributes.find(a=>a.id==='SELLER_SKU')?.value_name)throw Error('Conferência da variação falhou.');}
  await market.saveLocal(source.account,after);
  await p.auditLog.update({where:{id:audit.id},data:{after:{status:'VERIFIED',newChartId:newId,oldChartId,preservedMeasurements:true,preservedSkuPriceStock:true}}});
  console.log(JSON.stringify({reference,newChartId:newId,verified:true,measurementsPreserved:true,skuPriceStockPreserved:true}));
 }catch(e){await p.auditLog.update({where:{id:audit.id},data:{after:{status:sent?'UNVERIFIED':'FAILED',newChartId:newId??null,message:e.message}}});throw e;}
}
main().catch(e=>{console.error(JSON.stringify({message:e.message,status:e.response?.status,data:e.response?.data}));process.exitCode=1}).finally(()=>p.$disconnect());
