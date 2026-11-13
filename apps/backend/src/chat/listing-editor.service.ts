import { assertListingWritable, listingWriteBlock } from '../listings/listing-write-block';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreClient } from '../mercadolivre/mercadolivre.client';
import { ChatMarketplaceService, MarketplacePlan } from './chat-marketplace.service';
import { ChatPendingActionsService } from './chat-pending-actions.service';
import { ListingEditorDto } from './listing-editor.dto';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';

const attributeName=(attribute:any)=>attribute?.value_name??attribute?.values?.[0]?.name??'';
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const editorVersion=(value:any)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
@Injectable()
export class ListingEditorService {
  constructor(private readonly prisma:PrismaService,private readonly client:MercadoLivreClient,private readonly marketplace:ChatMarketplaceService,private readonly pending:ChatPendingActionsService){}
  private async load(accountId:string,reference:string){
    if(!/^MLB\d+$/.test(reference??''))throw new BadRequestException('Informe um anúncio válido.');
    const business=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:'BLING',active:true},select:{id:true,businessKey:true}});
    if(!business)throw new BadRequestException('Selecione uma conta Bling válida.');
    const source=await this.marketplace.chartSource(business,reference);
    const {account,token,item}=source;let family:any=null;let members:string[]=[];let items=[item];
    if(item.user_product_id){
      const up=await this.client.getUserProduct(token,item.user_product_id);
      if(String(up.user_id)!==account.sellerId)throw new BadRequestException('Produto de outro vendedor.');
      family=await this.client.getUserProductFamily(token,String(up.family_id));
      if(String(family.user_id)!==account.sellerId)throw new BadRequestException('Família de outro vendedor.');
      members=(await this.client.getFamilyUserProducts(token,String(family.family_id))).user_products_ids;
      const ids=new Set<string>();
      for(const member of members)for(const mlb of await this.client.searchUserProductOffers(token,account.sellerId,member))ids.add(mlb);
      ids.add(item.id);
      const responses=await this.client.getItems(token,[...ids]);
      if(responses.length!==ids.size||responses.some(response=>response.code!==200))throw new BadRequestException('Não foi possível consultar todas as ofertas da família.');
      items=responses.map(response=>response.body);
      if(items.some(value=>String(value.seller_id)!==account.sellerId||!members.includes(value.user_product_id??'')))throw new BadRequestException('Uma oferta não corresponde à família consultada.');
    }
    let definitions:any[]=[];let directStock=false;
    try{directStock=!(await this.client.getSeller(token,account.sellerId)).tags?.includes('warehouse_management');}catch{/* Stock permissions stay conservative when they cannot be checked. */}
    try{definitions=await this.client.getCategoryAttributeDefinitions(token,item.category_id!);}catch{/* No unverified attribute becomes editable. */}
    const attributes=(family?.attributes??item.attributes??[]).map((attribute:any)=>{
      const definition=definitions.find(definition=>definition.id===attribute.id);
      return {valueType:definition?.value_type,id:attribute.id,name:attribute.name??definition?.name??attribute.id,value:attributeName(attribute),valueId:attribute.values?.[0]?.id??attribute.value_id??null,editable:!!definition&&!definition.tags?.read_only&&!['ITEM_CONDITION','SELLER_SKU','COLOR','SIZE','SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(attribute.id),options:(definition?.values??[]).map((value:any)=>({id:String(value.id),name:value.name}))};
    });
    const snapshot={familyId:family?String(family.family_id):null,title:family?.family_name??item.title,members:[...members].sort(),attributes:attributes.map(({id,value,valueId}:any)=>({id,value,valueId})).sort((a:any,b:any)=>a.id.localeCompare(b.id)),offers:items.map(value=>({id:value.id,price:value.price,stock:value.available_quantity,status:value.status,sku:sellerSku(value),pictures:value.pictures,variations:value.variations?.map(variant=>({id:variant.id,sku:sellerSku(variant),stock:variant.available_quantity}))})).sort((a,b)=>a.id.localeCompare(b.id))};
    return {business,source,family,members,items,attributes,snapshot,directStock,version:editorVersion(snapshot)};
  }
  async uploadPhoto(accountId:string,userId:string,reference:string,file?:{buffer:Buffer;mimetype:string}){
    await this.marketplace.authorizeFiscal(userId);
    if(!file?.buffer?.length||file.buffer.length>10*1024*1024)throw new BadRequestException('Selecione uma imagem JPG ou PNG de até 10 MB.');
    const png=file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=file.buffer[0]===255&&file.buffer[1]===216&&file.buffer[2]===255;
    if(!png&&!jpeg)throw new BadRequestException('Formato inválido. Use uma imagem JPG ou PNG.');
    const business=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:'BLING',active:true},select:{id:true,businessKey:true}});
    if(!business)throw new BadRequestException('Selecione uma conta Bling válida.');
    if(!/^MLB\d+$/.test(reference??''))throw new BadRequestException('Informe um anúncio válido.');
    const source=await this.marketplace.chartSource(business,reference);
    await assertListingWritable(this.prisma,source.account.id,source.item);
    try{
      const picture=await this.client.uploadPicture(source.token,file.buffer,png?'image/png':'image/jpeg');
      const url=picture.variations?.find((variation:any)=>/^https:\/\//i.test(variation.secure_url??''))?.secure_url;
      if(!/^\d+-ML[A-Z]\d+_\d+$/.test(picture.id??'')||!url)throw new Error('Invalid picture response');
      return {id:picture.id,url};
    }catch{throw new BadRequestException('Não foi possível enviar a imagem ao Mercado Livre. Confira o arquivo e tente novamente.');}
  }
  async read(accountId:string,reference:string){
    const context=await this.load(accountId,reference);
    const descriptions=new Map<string,string>();
    for(let offset=0;offset<context.items.length;offset+=4){
      await Promise.all(context.items.slice(offset,offset+4).map(async item=>{descriptions.set(item.id,(await this.client.getDescription(context.source.token,item.id))?.plain_text??'');}));
    }
    for(const item of context.items)await this.marketplace.saveLocal(context.source.account,item);
    const view=this.view(context,reference);
    return {...view,offers:view.offers.map((offer:any)=>({...offer,description:descriptions.get(offer.reference)??''}))};
  }
  private view(context:any,reference:string){
    return {reference,hasBlockedOffers:context.items.some((item:any)=>!!listingWriteBlock(item)),version:context.version,familyId:context.snapshot.familyId,title:context.snapshot.title,attributes:context.attributes,account:context.source.account.name,offers:context.items.map((item:any)=>({reference:item.id,interactionBlocked:!!listingWriteBlock(item),interactionBlockReason:listingWriteBlock(item),title:item.title,sku:sellerSku(item)??'',price:item.price,stock:item.available_quantity,sold:item.sold_quantity,status:item.status,stockEditable:context.directStock&&!item.variations?.length&&item.shipping?.logistic_type!=='fulfillment',photo:item.pictures?.[0]?.secure_url??item.pictures?.[0]?.url,pictures:(item.pictures??[]).map((picture:any)=>({id:picture.id,url:picture.secure_url??picture.url})),permalink:item.permalink,attributes:item.attributes,variations:item.variations??[]}))};
  }
  async prepare(accountId:string,userId:string,input:ListingEditorDto){
    await this.marketplace.authorizeFiscal(userId);
    const context=await this.load(accountId,input.reference);
    if(input.version!==context.version)throw new ConflictException('Os dados mudaram. Atualize os detalhes antes de editar.');
    const familyBody:any={};const preview:any[]=[];const legacyChanges:any={mlb:input.reference};
    if(input.title!==undefined&&input.title!==context.snapshot.title){
      const title=input.title.trim();if(!title)throw new BadRequestException('Informe o nome do anúncio pai.');
      familyBody.family_name=title;legacyChanges.titulo=title;preview.push({field:context.family?'Nome da família':'Título',before:context.snapshot.title,after:title});
    }
    const seen=new Set<string>();const attributeChanges:any[]=[];
    for(const change of input.attributes??[]){
      if(seen.has(change.id))throw new BadRequestException('Há características repetidas.');seen.add(change.id);
      const current=context.attributes.find((attribute:any)=>attribute.id===change.id);
      if(!current?.editable)throw new BadRequestException('Esta característica não pode ser editada por este formulário.');
      const value=change.value.trim();if(!value)throw new BadRequestException('Informe o valor da característica.');
      if(value===current.value&&(!change.valueId||change.valueId===current.valueId))continue;
      const option=current.options.find((option:any)=>option.id===change.valueId&&option.name===value);
      if(current.options.length&&current.valueType!=='string'&&!option)throw new BadRequestException('Selecione uma opção válida da característica.');
      attributeChanges.push({id:change.id,values:[{id:option?.id??null,name:value}]});
      (legacyChanges.atributos??=[]).push({id:change.id,valor:value});
      preview.push({field:current.name,before:current.value,after:value});
    }
    if(attributeChanges.length)familyBody.attributes=attributeChanges;
    if(Object.keys(familyBody).length&&context.items.some(item=>!!listingWriteBlock(item)))throw new BadRequestException('Há ofertas bloqueadas nesta família. Edite preços, estoque, fotos e descrição somente das ofertas disponíveis; os dados compartilhados permanecem protegidos.');
    const changes:any[]=[];const offerSeen=new Set<string>();
    for(const offer of input.offers??[]){
      if(offerSeen.has(offer.reference))throw new BadRequestException('Anúncio repetido.');offerSeen.add(offer.reference);
      const current=context.items.find(item=>item.id===offer.reference);if(!current)throw new BadRequestException('Anúncio fora desta família.');
      const change:any={mlb:offer.reference};
      if(offer.description!==undefined)change.descricao=offer.description;
      if(offer.pictures!==undefined)change.fotos=offer.pictures;
      if(offer.variationPictures!==undefined)change.fotos_variacoes=offer.variationPictures.map(variant=>({id:variant.variationId,fotos:variant.pictures}));
      if(offer.price!==undefined&&offer.price!==current.price)change.preco=offer.price;
      if(offer.stock!==undefined&&offer.stock!==current.available_quantity){if(current.variations?.length||current.shipping?.logistic_type==='fulfillment')throw new BadRequestException('O estoque deste anúncio precisa ser gerenciado por variação ou depósito.');change.estoque=offer.stock;}
      if(offer.status!==undefined&&offer.status!==current.status)change.status=offer.status;
      if(Object.keys(change).length>1){await assertListingWritable(this.prisma,context.source.account.id,current);changes.push(change);}
    }
    if(!context.family&&Object.keys(legacyChanges).length>1){const matching=changes.find(change=>change.mlb===input.reference);if(matching)Object.assign(matching,legacyChanges);else changes.push(legacyChanges);}
    const plans:MarketplacePlan[]=[];
    for(let offset=0;offset<changes.length;offset+=20)plans.push(await this.marketplace.prepareUpdates(context.business,userId,changes.slice(offset,offset+20)));
    const plan=plans.length===1?plans[0]:undefined;
    const shared=context.family&&Object.keys(familyBody).length?familyBody:undefined;
    if(!shared&&!plans.length)throw new BadRequestException('Nenhuma alteração foi informada.');
    const id=randomUUID();await this.pending.save({id,accountId,userId,purpose:'LISTING_EDITOR',reference:input.reference,version:context.version,shared,plan,...(plans.length>1?{plans}:{}),expiresAt:Date.now()+10*60_000});
    return {id,familyId:context.snapshot.familyId,shared:shared?preview:[],offers:plans.flatMap(p=>p.targets.map(target=>target.preview)),affected:shared?context.items.map(item=>item.id):plans.flatMap(p=>p.targets.map(target=>target.mlb))};
  }
  async confirm(accountId:string,userId:string,id:string){
    await this.marketplace.authorizeFiscal(userId);
    const saved=await this.pending.load(id,accountId,userId);
    if(saved?.purpose!=='LISTING_EDITOR'||saved.expiresAt<Date.now())throw new NotFoundException('Revisão expirada. Prepare novamente.');
    const context=await this.load(accountId,saved.reference);
    const targets:MarketplacePlan[]=saved.plans??(saved.plan?[saved.plan]:[]);
    for(const item of context.items)if(saved.shared||targets.some(plan=>plan.targets.some(target=>target.mlb===item.id)))await assertListingWritable(this.prisma,context.source.account.id,item);
    if(context.version!==saved.version)throw new ConflictException('A família ou as ofertas mudaram. Prepare uma nova revisão.');
    await this.pending.claim(id,accountId,userId,'CLAIMED');
    const audit=await this.prisma.auditLog.create({data:{userId,action:'LISTING_EDITOR_UPDATE',entityType:'MarketplaceListing',entityId:saved.reference,before:{accountId,...context.snapshot},after:{accountId,status:'RUNNING',requested:saved.shared??{offers:true}}}});
    let sent=false;
    try{
      if(saved.shared){
        sent=true;await this.client.updateUserProductFamily(context.source.token,String(context.family.family_id),saved.shared);
        const fresh=await this.client.getUserProductFamily(context.source.token,String(context.family.family_id));
        const members=(await this.client.getFamilyUserProducts(context.source.token,String(context.family.family_id))).user_products_ids;
        const unchangedMembers=JSON.stringify([...members].sort())===JSON.stringify([...context.members].sort());
        if(!unchangedMembers||saved.shared.family_name&&fresh.family_name!==saved.shared.family_name||(saved.shared.attributes??[]).some((wanted:any)=>{const actual=fresh.attributes?.find((attribute:any)=>attribute.id===wanted.id);return attributeName(actual)!==wanted.values[0].name;}))throw new Error('A leitura ainda não confirmou a atualização da família.');
      }
      const plans:MarketplacePlan[]=saved.plans??(saved.plan?[saved.plan]:[]);
      let result={success:true,message:'Dados compartilhados da família atualizados e verificados.'};
      for(const plan of plans){result=await this.marketplace.execute(plan,context.business,userId);if(!result.success)break;}
      if(plans.length>1&&result.success)result={success:true,message:'Alterações de todos os anúncios da família enviadas e verificadas.'};
      for(const old of context.items){const fresh=await this.client.getItem(context.source.token,old.id);await this.marketplace.saveLocal(context.source.account,fresh);}
      await this.prisma.auditLog.update({where:{id:audit.id},data:{after:{accountId,status:result.success?'VERIFIED':'UNVERIFIED',requested:saved.shared??{offers:true},message:result.message}}});
      return result;
    }catch(error){
      const status=Number((error as any)?.response?.status)||null;
      const rejected=status!==null&&[400,403,409,422].includes(status);
      const data=(error as any)?.response?.data;
      const details=[data?.message,data?.error,...(Array.isArray(data?.cause)?data.cause.flatMap((cause:any)=>[cause.code,cause.message]):[])].filter((value):value is string=>typeof value==='string'&&!/bearer|access_token|refresh_token|client_secret|APP_USR/i.test(value)).join(' · ').slice(0,700);
      const message=rejected?`O Mercado Livre recusou a alteração (HTTP ${status}). ${details||'Confira os dados e as regras da família.'}`:sent?'A alteração da família foi enviada, mas a conferência não terminou. Confira os detalhes antes de repetir.':'Não foi possível confirmar a operação. Confira o histórico antes de repetir.';
      await this.prisma.auditLog.update({where:{id:audit.id},data:{after:{accountId,status:rejected?'REJECTED':'UNVERIFIED',providerStatus:status,message,requested:saved.shared??{offers:true}}}});
      return {success:false,message};
    }
  }
  async cancel(accountId:string,userId:string,id:string){const saved=await this.pending.load(id,accountId,userId);if(saved?.purpose!=='LISTING_EDITOR')throw new NotFoundException('Revisão não encontrada.');await this.pending.claim(id,accountId,userId,'CANCELLED');return {success:true};}
}
