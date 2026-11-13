import { assertListingWritable, listingWriteBlock } from '../listings/listing-write-block';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatMarketplaceService, MarketplacePlan } from '../chat/chat-marketplace.service';
import { ChatPendingActionsService } from '../chat/chat-pending-actions.service';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';
import { correspondingVariant, sameSize } from './sku-correspondence';
import { SkuLinkPreviewDto } from './sku-link.dto';
import { blingGrade } from '../bling/bling-grade';
import { normalizeBlingParentSku } from '../bling/parent-sku';
import { skuListingDimensions } from './sku-listing-dimensions';

@Injectable()
export class SkuLinkService {
  constructor(private readonly prisma: PrismaService, private readonly marketplace: ChatMarketplaceService, private readonly pending: ChatPendingActionsService) {}
  private async context(accountId: string, parentSku: string) {
    parentSku=normalizeBlingParentSku(parentSku);
    const business = await this.prisma.marketplaceAccount.findFirst({ where: { id: accountId, marketplace: 'BLING', active: true }, select: { id: true, businessKey: true } });
    if (!business) throw new BadRequestException('Selecione a conta Bling da operação.');
    const product = await this.prisma.product.findFirst({ where: { blingAccountId: business.id, sku: parentSku }, orderBy:{variants:{_count:'desc'}}, include: { variants: { orderBy: { sku: 'asc' } } } });
    if (!product?.variants.length) throw new BadRequestException('SKU pai não encontrado com variações nesta conta. Confira o código ou sincronize a Bling.');
    product.variants=product.variants.map(variant=>({...variant,...blingGrade(variant.color,variant.size)})) as typeof product.variants;
    const rows = product.variants.map(v => ({ sku: v.sku, cor: v.color, tamanho: v.size }));
    return { business, product, rows };
  }
  private async catalogContext(accountId:string,parentSku:string,extraParents:string[]=[]){
    const parents=[...new Set([parentSku,...extraParents].map(normalizeBlingParentSku))];
    if(parents.length>20)throw new BadRequestException('Use no máximo 20 produtos pai por vinculação.');
    const contexts=[];
    for(const parent of parents)contexts.push(await this.context(accountId,parent));
    const rows=contexts.flatMap(context=>context.rows);
    if(new Set(rows.map(row=>row.sku)).size!==rows.length)throw new BadRequestException('Há SKUs de variação repetidos entre os produtos pai. Corrija o catálogo antes de vincular.');
    return {...contexts[0],rows,products:contexts.map(context=>context.product),parentSkus:parents};
  }
  async manualOptions(accountId:string,userId:string,dto:SkuLinkPreviewDto){
    const {business,products}=await this.catalogContext(accountId,dto.parentSku,dto.parentSkus??[]);
    await this.marketplace.authorizeFiscal(userId);
    const sources=await this.marketplace.fiscalSources(business,dto.reference);
    // Loading options is read-only; blocked offers can still be explicitly skipped.
    const rows=sources.flatMap(({item})=>(item as any).sub_status?.includes('deleted')?[]:(item.variations?.length?item.variations:[item]).map(variant=>({mlb:item.id,interactionBlocked:!!listingWriteBlock(item),variationId:variant===item?'':String(variant.id),...skuListingDimensions(variant),before:sellerSku(variant)??''})));
    if(!rows.length)throw new BadRequestException('Nenhuma variação encontrada.');
    return {rows,options:products.flatMap(product=>product.variants.map(v=>({sku:v.sku,color:v.color,size:v.size,parentSku:product.sku})))};
  }
  async preview(accountId: string, userId: string, dto: SkuLinkPreviewDto) {
    const parentSku = normalizeBlingParentSku(dto.parentSku);
    const extraParents=[...(dto.parentSkus??[]),...(dto.choices??[]).flatMap(choice=>choice.parentSku?[choice.parentSku]:[])];
    const { business, product, products, rows, parentSkus } = await this.catalogContext(accountId, parentSku,extraParents);
    await this.marketplace.authorizeFiscal(userId);
    const sources = await this.marketplace.fiscalSources(business, dto.reference);
    const skipped=[...(dto.skipped??[])];
    for(const {item} of sources)if(listingWriteBlock(item))for(const variant of item.variations?.length?item.variations:[item]){
      const variationId=variant===item?'':String(variant.id);
      if(!skipped.some(row=>row.mlb===item.id&&row.variationId===variationId))skipped.push({mlb:item.id,variationId});
    }
    const isSkipped=(mlb:string,variationId:string)=>skipped.some(row=>row.mlb===mlb&&row.variationId===variationId);
    if(skipped.some(row=>!sources.some(({item})=>item.id===row.mlb&&(item.variations?.length?item.variations.some(variant=>String(variant.id)===row.variationId):row.variationId===''))))throw new BadRequestException('Uma oferta marcada para deixar sem vínculo não pertence ao anúncio.');
    for(const source of sources)if((source.item.variations?.length?source.item.variations:[source.item]).some(variant=>!isSkipped(source.item.id,variant===source.item?'':String(variant.id))))await assertListingWritable(this.prisma,source.account.id,source.item);
    const familyMembers = sources.map(source => source.item.id).sort();
    const choices = dto.choices ?? [];
    if(choices.some(row=>isSkipped(row.mlb,row.variationId)))throw new BadRequestException('Uma variação não pode ser vinculada e ignorada ao mesmo tempo.');
    for(const choice of choices){
      const owner=products.find(product=>product.sku===normalizeBlingParentSku(choice.parentSku??parentSku));
      if(!owner?.variants.some(variant=>variant.sku===choice.sku))throw new BadRequestException('Seleção manual inválida: o SKU escolhido não pertence ao produto pai informado para esta variação.');
    }
    const choiceKeys = choices.map(choice => `${choice.mlb}:${choice.variationId}`);
    if (new Set(choiceKeys).size !== choiceKeys.length || choices.some(choice => !rows.some(row => row.sku === choice.sku))) throw new BadRequestException('Seleção manual inválida: escolha SKUs do produto pai informado, sem repetir a mesma variação.');
    const unresolved: any[] = [];
    const links: Array<{ mlb: string; variationId: string | null; sku: string; before: string; color: string; size: string }> = [];
    for (const { item } of sources) {
      if((item as any).sub_status?.includes('deleted'))continue;
      for (const variant of item.variations?.length ? item.variations : [item]) {
        const {color,size}=skuListingDimensions(variant);
        const variationId = variant === item ? '' : String(variant.id);
        if(isSkipped(item.id,variationId))continue;
        const choice = choices.find(row => row.mlb === item.id && row.variationId === variationId);
        if(dto.manual&&!choice)throw new BadRequestException('Informe manualmente o SKU de todas as variações antes de revisar.');
        const match = choice ? rows.find(row => row.sku === choice.sku) : correspondingVariant(rows, color, size);
        if (choice && match && size && !sameSize(size, match.tamanho)) throw new BadRequestException('Tamanho incompatível: o SKU '+match.sku+' possui tamanho '+match.tamanho+' na Bling; o anúncio '+item.id+' possui '+size+'.');
        if (!match) { const missingSize=!!size&&!rows.some(row=>sameSize(size,row.tamanho));unresolved.push({ mlb: item.id, variationId, color, size, before: sellerSku(variant) ?? '', sku: '',missingInBling:missingSize,warning:missingSize?'O tamanho '+size+' não existe na grade deste produto na Bling. Confira o cadastro ou exclua esta oferta.':'' }); continue; }
        links.push({ mlb: item.id, variationId: variant === item ? null : String(variant.id), sku: match.sku, before: sellerSku(variant) ?? '', color, size });
      }
    }
    if (choices.some(choice => !links.some(link => link.mlb === choice.mlb && (link.variationId ?? '') === choice.variationId))) throw new BadRequestException('Uma seleção manual não pertence ao anúncio atual.');
    if (unresolved.length) throw new BadRequestException({ code: 'SKU_MANUAL_SELECTION_REQUIRED', message: 'Escolha a variação Bling para os itens sem correspondência automática.', rows: unresolved, options: products.flatMap(product=>product.variants.map(v=>({sku:v.sku,color:v.color,size:v.size,parentSku:product.sku}))) });
    if (!links.length&&!skipped.length) throw new BadRequestException('Nenhuma variação encontrada.');
    const plan:MarketplacePlan = links.length?await this.marketplace.prepareCatalogSkuCorrection(business, userId, dto.reference, rows, choices,skipped):{kind:'update',targets:[]};
    plan.family = { reference: dto.reference, members: familyMembers };
    const id = randomUUID();
    await this.pending.save({ id, accountId, userId, purpose: 'SKU_LINK', parentSku, parentSkus, reference: dto.reference, rows, links, choices, skipped,plan, expiresAt: Date.now() + 30 * 60_000 });
    return { id, skipped,product: { sku: product.sku, title: product.title }, rows: links.map(link=>({...link,parentSku:products.find(product=>product.variants.some(variant=>variant.sku===link.sku))?.sku})), changes: plan.targets.map(t => t.preview) };
  }
  async confirm(accountId: string, userId: string, id: string) {
    const saved = await this.pending.load(id, accountId, userId);
    if (!saved || saved.purpose !== 'SKU_LINK' || saved.expiresAt < Date.now()) throw new ConflictException('Prévia expirada ou já utilizada. Prepare novamente.');
    const { business, products, rows } = await this.catalogContext(accountId, saved.parentSku,saved.parentSkus??[]);
    const catalogSnapshot = (items: typeof rows) => items.map(row => [row.sku, row.cor, row.tamanho]);
    if (JSON.stringify(catalogSnapshot(rows)) !== JSON.stringify(catalogSnapshot(saved.rows))) throw new ConflictException('O catálogo mudou. Prepare uma nova prévia.');
    await this.marketplace.authorizeFiscal(userId);
    const currentSources = await this.marketplace.fiscalSources(business, saved.reference);
    const isSkipped=(mlb:string,variationId:string)=>(saved.skipped??[]).some((row:any)=>row.mlb===mlb&&row.variationId===variationId);
    for(const source of currentSources)if((source.item.variations?.length?source.item.variations:[source.item]).some(variant=>!isSkipped(source.item.id,variant===source.item?'':String(variant.id))))await assertListingWritable(this.prisma,source.account.id,source.item);
    const currentLinks = currentSources.flatMap(({ item }) => (item.variations?.length ? item.variations : [item]).filter(variant=>!isSkipped(item.id,variant===item?'':String(variant.id))).map(variant => {
      const {color,size}=skuListingDimensions(variant);
      const variationId = variant === item ? null : String(variant.id);
      const choice = (saved.choices ?? []).find((row: any) => row.mlb === item.id && row.variationId === (variationId ?? ''));
      if (choice && size && !sameSize(size, rows.find(row => row.sku === choice.sku)?.tamanho)) throw new ConflictException('O tamanho do SKU escolhido difere do anúncio. Prepare novamente.');
      return { mlb: item.id, variationId, sku: choice?.sku ?? correspondingVariant(rows, color, size)?.sku, before: sellerSku(variant) ?? '', color, size };
    }));
    const sorted = (items: any[]) => [...items].sort((a,b) => `${a.mlb}:${a.variationId}`.localeCompare(`${b.mlb}:${b.variationId}`)).map(row => [row.mlb,row.variationId,row.sku,row.before,row.color,row.size]);
    if (JSON.stringify(sorted(currentLinks)) !== JSON.stringify(sorted(saved.links))) throw new ConflictException('As variações, os atributos ou SKUs do anúncio mudaram. Prepare uma nova prévia.');
    await this.pending.claim(id, accountId, userId, 'CLAIMED');
    if(!saved.links.length)return {success:true,linked:0,total:0,linkedItems:[],skipped:saved.skipped?.length??0,message:'As ofertas selecionadas foram deixadas sem novo vínculo. Nenhuma alteração foi enviada ao Mercado Livre.'};
    const result = await this.marketplace.execute(saved.plan as MarketplacePlan, business, userId);
    // Re-read the seller's actual SKUs before recording any local correspondence.
    const sources = await this.marketplace.fiscalSources(business, saved.reference);
    let linked = 0;
    const linkedItems: Array<{ mlb: string; variationId: string | null; color: string; size: string; before: string; sku: string }> = [];
    for (const { item, account } of sources) {
      if(!saved.links.some((row:any)=>row.mlb===item.id))continue;
      // Always refresh the full listing, including already-correct and partially applied rows.
      await this.marketplace.saveLocal(account, item);
      const listing = await this.prisma.marketplaceListing.findUnique({ where: { marketplaceAccountId_itemId: { marketplaceAccountId: account.id, itemId: item.id } }, include: { variants: true } });
      if (!listing) continue;
      for (const variant of item.variations?.length ? item.variations : [item]) {
        const variationId = variant === item ? null : String(variant.id);
        const wanted = saved.links.find((row: any) => row.mlb === item.id && row.variationId === variationId);
        if (!wanted || sellerSku(variant) !== wanted.sku) continue;
        const {color,size}=skuListingDimensions(variant);
        const manual = (saved.choices ?? []).some((row: any) => row.mlb === item.id && row.variationId === (variationId ?? '') && row.sku === wanted.sku);
        if (manual ? color !== wanted.color || size !== wanted.size : correspondingVariant(rows, color, size)?.sku !== wanted.sku) continue;
        const owner=products.find(product=>product.variants.some(variant=>variant.sku===wanted.sku));
        const catalog=owner?.variants.find(variant=>variant.sku===wanted.sku);
        if(!owner||!catalog)continue;
        const local = variationId ? listing.variants.find(v => v.variationId === variationId) : null;
        if (variationId && !local) continue;
        await this.prisma.$transaction(async tx => {
          await tx.marketplaceListing.update({ where: { id: listing.id }, data: { rawData: item as unknown as Prisma.InputJsonValue } });
          if (local) await tx.marketplaceListingVariant.update({ where: { id: local.id }, data: { sku: wanted.sku, rawData: variant as unknown as Prisma.InputJsonValue, attributes: { attribute_combinations: (variant as any).attribute_combinations ?? [] } } });
          const before = await tx.listingProductLink.findMany({ where: { listingId: listing.id, listingVariantId: local?.id ?? null } });
          await tx.listingProductLink.deleteMany({ where: { listingId: listing.id, listingVariantId: local?.id ?? null } });
          const link = await tx.listingProductLink.create({ data: { listingId: listing.id, listingVariantId: local?.id ?? null, productId: owner.id, productVariantId: catalog.id, matchType: 'MANUAL', confidence: 100, manuallyConfirmed: true } });
          await tx.auditLog.create({ data: { userId, action: 'SKU_CORRECTION_LINK', entityType: 'ListingProductLink', entityId: link.id, before, after: link } });
        });
        linked++;
        linkedItems.push({ mlb: item.id, variationId, color: wanted.color, size: wanted.size, before: wanted.before, sku: wanted.sku });
      }
    }
    return { success: result.success && linked === saved.links.length, linked, total: saved.links.length, linkedItems,skipped:saved.skipped?.length??0, message: `${linked} de ${saved.links.length} vínculo(s) confirmados. ${(saved.skipped?.length??0)?saved.skipped.length+' oferta(s) deixada(s) sem novo vínculo. ':''}${result.message}` };
  }
}
