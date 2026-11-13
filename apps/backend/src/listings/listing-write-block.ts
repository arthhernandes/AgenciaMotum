import { BadRequestException } from '@nestjs/common';
export const PUBLICATION_BLOCK_CATEGORY='LISTING_PUBLICATION_BLOCK';
export const FINALIZED_MESSAGE='Anúncio finalizado ou bloqueado pelo Mercado Livre. Alterações, vínculos, duplicação e novas publicações estão desabilitados. Consulte os detalhes ou solicite revisão ao Mercado Livre.';
export function listingWriteBlock(item:any):string|undefined{
  if(item.interactionBlocked)return item.interactionBlockReason??FINALIZED_MESSAGE;
  const subStatus=item.sub_status??item.rawData?.sub_status??[];
  if(item.status==='closed'||subStatus.includes('deleted')||subStatus.includes('forbidden'))return FINALIZED_MESSAGE;
  return undefined;
}
export async function assertListingWritable(prisma:any,accountId:string,item:any){
  const reason=listingWriteBlock(item);if(reason)throw new BadRequestException(reason);
  const up=item.user_product_id??item.userProductId,family=item.family_id??item.rawData?.family_id;
  if(!up&&!family)return;
  const block=await prisma.integrationSnapshot?.findFirst({where:{marketplaceAccountId:accountId,category:PUBLICATION_BLOCK_CATEGORY,OR:[...(up?[{key:up}]:[]),...(family?[{payload:{path:['familyId'],equals:String(family)}}]:[])]}});
  if(block)throw new BadRequestException(FINALIZED_MESSAGE);
}
