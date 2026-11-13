require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');const {consolidateCatalogParents}=require('../apps/backend/dist/src/olist/synchronization/consolidate-catalog-parents');
const p=new PrismaClient();
(async()=>{
 const account='olist-ts-comercio';
 const active=await p.syncExecution.count({where:{marketplaceAccountId:account,status:'RUNNING'}});
 if(active)throw new Error('A catalog synchronization is running; wait before consolidating');
 const before=await p.productVariant.findMany({where:{olistAccountId:account},select:{id:true,sku:true,olistVariantId:true}});
 const consolidated=await consolidateCatalogParents(p,account);
 const after=await p.productVariant.findMany({where:{olistAccountId:account},select:{id:true,sku:true,olistVariantId:true}});
 const key=rows=>JSON.stringify(rows.sort((a,b)=>a.id.localeCompare(b.id)));
 if(key(before)!==key(after))throw new Error('Unexpected variant identity change');
 const rows=await p.product.findMany({where:{olistAccountId:account,sku:'58447',variants:{some:{}}},include:{_count:{select:{variants:true}}}});
 console.log(JSON.stringify({consolidated,identitiesPreserved:true,sku58447:rows.map(row=>({id:row.id,variants:row._count.variants}))}));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>p.$disconnect());
