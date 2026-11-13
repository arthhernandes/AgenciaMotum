import { BadRequestException, Body, ConflictException, Controller, Injectable, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreClient } from '../mercadolivre/mercadolivre.client';
import { BlingSyncService } from '../bling/synchronization/bling-sync.service';
import { colorKey, sameSize } from '../listing-links/sku-correspondence';
import { skuListingDimensions } from '../listing-links/sku-listing-dimensions';
import { ChatMarketplaceService } from './chat-marketplace.service';
import { ChatPendingActionsService } from './chat-pending-actions.service';
import { editorVersion } from './listing-editor.service';

export class MissingSkuRemovalDto {
 @IsString() @Matches(/^MLB\d+$/) reference!:string;
 @IsString() @MaxLength(100) parentSku!:string;
 @IsString() @Matches(/^MLB\d+$/) mlb!:string;
 @IsOptional() @IsString() @Matches(/^\d*$/) variationId?:string;
 @IsOptional() @IsBoolean() noCorrespondence?:boolean;
}
export class MissingSkuRemovalConfirmDto {
 @IsOptional() @IsUUID() previousReviewId?:string;
}
@Injectable()
export class SkuMissingRemovalService {
 constructor(private prisma:PrismaService,private client:MercadoLivreClient,private bling:BlingSyncService,private market:ChatMarketplaceService,private pending:ChatPendingActionsService){}
 private fingerprint(item:any){return editorVersion({id:item.id,seller:item.seller_id,status:item.status,subStatus:item.sub_status,updated:item.last_updated,attributes:item.attributes,variations:item.variations,stock:item.available_quantity,price:item.price});}
 private async readback(token:string,account:any,input:MissingSkuRemovalDto,before:any){
  let failure:unknown;
  for(let attempt=0;attempt<3;attempt++){
   try{
    const fresh=await this.client.getItem(token,input.mlb);
    if(String(fresh.seller_id)!==account.sellerId)throw new Error('Vendedor divergente');
    if(input.variationId){
     const wanted=before.variations.filter((v:any)=>String(v.id)!==input.variationId).map((v:any)=>String(v.id)).sort();
     if(JSON.stringify(wanted)!==JSON.stringify((fresh.variations??[]).map(v=>String(v.id)).sort()))throw new Error('Variações não confirmadas');
    }else if(fresh.status!=='closed'||!(fresh as any).sub_status?.includes('deleted'))throw new Error('Exclusão não confirmada');
    return fresh;
   }catch(error){failure=error;if(attempt<2)await this.readbackDelay(500*(attempt+1));}
  }
  throw failure;
 }
 private async readbackDelay(ms:number){await new Promise(resolve=>setTimeout(resolve,ms));}
 private async inspect(accountId:string,userId:string,input:MissingSkuRemovalDto){
  await this.market.authorizeFiscal(userId);
  const business=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:'BLING',active:true},select:{id:true,businessKey:true}});if(!business)throw new BadRequestException('Selecione uma conta Bling ativa.');
  const sources=await this.market.fiscalSources(business,input.reference),source=sources.find(s=>s.item.id===input.mlb);if(!source)throw new BadRequestException('Oferta fora do anúncio selecionado.');
  const item=source.item as any;if(String(item.seller_id)!==source.account.sellerId)throw new BadRequestException('Oferta de outro vendedor.');
  const variant=input.variationId?item.variations?.find((v:any)=>String(v.id)===input.variationId):item;
  if(!variant||!input.variationId&&item.variations?.length)throw new BadRequestException('Selecione somente a variação ausente, preservando as demais.');
  const dimensions=skuListingDimensions(variant);if(!dimensions.size)throw new BadRequestException('O tamanho não foi identificado; não é possível confirmar ausência na Bling.');
  const catalog=await this.bling.publicationSource(accountId,input.parentSku);
  if(!catalog.rows?.length||catalog.rows.some(row=>!row.size))throw new BadRequestException('Não foi possível conferir a grade completa na Bling.');
  if(catalog.rows.some(row=>sameSize(dimensions.size,row.size))){
   if(!input.noCorrespondence)throw new ConflictException('Esse tamanho existe na Bling. Confira a correspondência de cor e SKU antes de excluir.');
   if(!dimensions.color||catalog.rows.some(row=>!row.color))throw new BadRequestException('Não foi possível conferir as cores da grade completa na Bling.');
   if(catalog.rows.some(row=>sameSize(dimensions.size,row.size)&&colorKey(row.color)===colorKey(dimensions.color)))throw new ConflictException('Essa cor e tamanho existem na Bling. Confira o SKU correspondente antes de excluir.');
  }
  if(input.variationId&&item.variations.length===1)throw new BadRequestException('Esta é a última variação. Confira o anúncio completo antes de excluir.');
  return {source,item,dimensions,fingerprint:this.fingerprint(item),catalogSizes:[...new Set(catalog.rows.map(row=>row.size))]};
 }
 async prepare(accountId:string,userId:string,input:MissingSkuRemovalDto){
  const context=await this.inspect(accountId,userId,input),id=randomUUID();
  await this.pending.save({id,accountId,userId,purpose:'SKU_MISSING_REMOVAL',input,fingerprint:context.fingerprint,sellerId:context.source.account.sellerId,expiresAt:Date.now()+10*60_000});
  return {id,mlb:input.mlb,variationId:input.variationId??'',...context.dimensions,catalogSizes:context.catalogSizes,message:input.variationId?'Excluir somente esta variação do Mercado Livre. As demais serão preservadas.':'Encerrar e excluir somente este MLB do Mercado Livre. Os outros tamanhos e cores serão preservados.'};
 }
 async confirm(accountId:string,userId:string,id:string,previousReviewId?:string){
  await this.market.authorizeFiscal(userId);const saved=await this.pending.load(id,accountId,userId);
  if(saved?.purpose!=='SKU_MISSING_REMOVAL'||saved.expiresAt<Date.now())throw new NotFoundException('A confirmação expirou ou já foi utilizada. Confira o resultado antes de repetir.');
  const context=await this.inspect(accountId,userId,saved.input);
  let expectedFingerprint=saved.fingerprint;
  if(previousReviewId){
   // Continue only from the exact readback of a verified removal in this batch.
   const previous=await this.prisma.auditLog.findFirst({where:{userId,action:'SKU_MISSING_REMOVAL',entityType:'MarketplaceListing',entityId:saved.input.mlb,after:{path:['reviewId'],equals:previousReviewId}},orderBy:{createdAt:'desc'}});
   const verified=previous?.after as any;
   if(verified?.status!=='VERIFIED'||verified.accountId!==accountId||verified.rootFingerprint!==saved.fingerprint)throw new ConflictException('A exclusão anterior não pertence a esta revisão. Confira as ofertas novamente.');
   expectedFingerprint=verified.fingerprint;
  }
  if(context.fingerprint!==expectedFingerprint||context.source.account.sellerId!==saved.sellerId)throw new ConflictException('A oferta mudou. Revise novamente antes de excluir.');
  const audit=await this.prisma.auditLog.create({data:{userId,action:'SKU_MISSING_REMOVAL',entityType:'MarketplaceListing',entityId:saved.input.mlb,before:{accountId,input:saved.input,item:context.item},after:{status:'PREPARED'}}});
  await this.pending.claim(id,accountId,userId,'CLAIMED');let sent=false;let writeFailure:any;
  try{
   const {token,account}=context.source,input=saved.input;
   try{
   if(input.variationId){sent=true;await this.client.deleteVariation(token,input.mlb,input.variationId);}
   else{const direct=context.item.status==='under_review'&&context.item.sub_status?.includes('forbidden');if(context.item.status!=='closed'&&!direct){sent=true;await this.client.updateItem(token,input.mlb,{status:'closed'});const closed=await this.client.getItem(token,input.mlb);if(closed.status!=='closed'||String(closed.seller_id)!==account.sellerId)throw new Error('Encerramento não confirmado');}sent=true;await this.client.updateItem(token,input.mlb,{deleted:true});}
   }catch(error){writeFailure=error;}
   // A timed-out DELETE can have succeeded. Retry only the read, never the write.
   const fresh=await this.readback(token,account,input,context.item);
   await this.market.saveLocal(account,fresh);await this.prisma.auditLog.update({where:{id:audit.id},data:{after:{status:'VERIFIED',mlb:input.mlb,variationId:input.variationId??'',reviewId:id,accountId,rootFingerprint:saved.fingerprint,fingerprint:this.fingerprint(fresh)}}});
   return {success:true,mlb:input.mlb,variationId:input.variationId??'',message:'Exclusão confirmada no Mercado Livre.'};
  }catch{await this.prisma.auditLog.update({where:{id:audit.id},data:{after:{status:'UNVERIFIED',sent,...(writeFailure?{httpStatus:Number(writeFailure?.response?.status)||null,errorCode:typeof writeFailure?.code==='string'?writeFailure.code.slice(0,40):null}:{})}}});return {success:false,message:'A exclusão não foi confirmada. Confira o anúncio no Mercado Livre antes de tentar novamente.'};}
 }
}
@Controller('listing-links/sku/missing-removal')
@UseGuards(JwtAuthGuard)
export class SkuMissingRemovalController {
 constructor(private removal:SkuMissingRemovalService){}
 @Post('prepare') prepare(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@Body() b:MissingSkuRemovalDto){return this.removal.prepare(a,r.user.id,b);}
 @Post(':id/confirm') confirm(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@Param('id') id:string,@Body() b:MissingSkuRemovalConfirmDto){return this.removal.confirm(a,r.user.id,id,b?.previousReviewId);}
}
