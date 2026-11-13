import {PrismaClient} from '@prisma/client';

// Preserve imported parent records, but put their actual grade under one local parent.
// Variant IDs and external Bling references are never rewritten or deleted.
export async function consolidateCatalogParents(prisma:PrismaClient,accountId:string){
 const products=await prisma.product.findMany({where:{blingAccountId:accountId},include:{_count:{select:{links:true}},variants:{select:{id:true,sku:true,_count:{select:{links:true}}}}}});
 const groups=new Map<string,typeof products>();
 for(const product of products){if(!/^\d+$/.test(product.sku))continue;const key=product.sku;groups.set(key,[...(groups.get(key)??[]),product]);}
 let consolidated=0;
 for(const group of groups.values()){
  const populated=group.filter(product=>product.variants.some(variant=>variant.sku!==product.sku));
  if(!populated.length)continue;
  const ordered=[...populated].sort((a,b)=>b.variants.length-a.variants.length||a.id.localeCompare(b.id));
  const target=ordered[0],sources=group.filter(product=>product.id!==target.id&&(product.variants.some(variant=>variant.sku!==product.sku)||(product._count?.links??0)>0||product.variants.some(variant=>(variant._count?.links??0)>0)));
  if(!sources.length)continue;
  await prisma.$transaction(async tx=>{
   const sourceIds=sources.map(product=>product.id);
   const baseVariantIds=sources.flatMap(product=>product.variants.filter(variant=>variant.sku===target.sku).map(variant=>variant.id));
   await tx.productVariant.updateMany({where:{blingAccountId:accountId,productId:{in:sourceIds},sku:{not:target.sku}},data:{productId:target.id}});
   await tx.listingProductLink.updateMany({where:{productId:{in:sourceIds}},data:{productId:target.id}});
   await tx.auditIssue.updateMany({where:{productId:{in:sourceIds}},data:{productId:target.id}});
   if(baseVariantIds.length){
    // A former base-SKU link now belongs to the unified parent, not an invented size.
    const links=await tx.listingProductLink.findMany({where:{productVariantId:{in:baseVariantIds}}});
    await tx.auditLog.create({data:{action:'CATALOG_BASE_LINK_CONSOLIDATION',entityType:'Product',entityId:target.id,before:{links,baseVariantIds},after:{parentId:target.id,productVariantId:null}}});
    await tx.listingProductLink.updateMany({where:{productVariantId:{in:baseVariantIds}},data:{productId:target.id,productVariantId:null}});
    await tx.auditIssue.updateMany({where:{productVariantId:{in:baseVariantIds}},data:{productId:target.id,productVariantId:null}});
   }
   await tx.auditLog.create({data:{action:'CATALOG_PARENT_CONSOLIDATION',entityType:'Product',entityId:target.id,before:{accountId,sku:target.sku,sources:sources.map(product=>({id:product.id,blingProductId:product.blingProductId,variants:product.variants.map(variant=>variant.id)}))},after:{parentId:target.id,preservedVariantIds:true}}});
  });
  consolidated++;
 }
 return consolidated;
}
