import { assertListingWritable } from '../listings/listing-write-block';
import { MAX_VARIATION_SELECTION, VARIATION_BATCH_SIZE, VariationBatchProgress } from './variation-batches';
import { effectivePermissions } from '../auth/permissions';
import { sizeChartPolicy } from './size-chart-policy';
﻿import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { groupListings } from '../listings/group-listings';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';
import { MercadoLivreClient, MeliItemResponse } from '../mercadolivre/mercadolivre.client';
import { assertCatalogAttributes } from './chat-catalog';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';
import { pruneListingVariants } from '../mercadolivre/synchronization/prune-listing-variants';
import { correspondingVariant, sameSize } from '../listing-links/sku-correspondence';
import { skuListingDimensions } from '../listing-links/sku-listing-dimensions';
import { ChatFamilyVariants } from './chat-family-variants';
import { applySharedStock } from '../bling/synchronization/shared-stock';
import { variantColorName } from './variant-color-name';
import { BlingSyncService } from '../bling/synchronization/bling-sync.service';
import { ChatSizeCharts, chartSizeKey, createdSizeCharts } from './chat-size-charts';
import { StandardPrice, standardPrices, proposedPrices, withoutPrice } from './chat-standard-prices';

type BusinessAccount = { id: string; businessKey: string };
type SellerAccount = { id: string; name: string; sellerId: string };
export type PreviewField = { field: string; before: string; bling?: string; after: string };
export type MarketplacePreview = { mlb: string; title: string; account: string; fields: PreviewField[]; notes: string[] };
export type Target = {
  account: SellerAccount; mlb: string; fingerprint: string; before: Record<string, unknown>;
  body: Record<string, any>; description?: string; descriptionBefore?: string | null;
  baseline?: Record<string, any>; desired?: Record<string, any>; attributeIds?: string[];
  variationAttributeIds?: Record<string, string[]>; userProductId?: string;
  refreshBlingStockForAdditions?:boolean;
  additionWarehouse?:{store_id:string;network_node_id:string};
  standardPrice?:{before:StandardPrice[];prices:StandardPrice[]};
  removeAutomation?:{mlb:string;ruleId:string;minPrice:number|null;maxPrice:number|null};
  preview: MarketplacePreview;
  familyVariant?: {familyId:string;familySnapshot:string;sku:string;productId:string;productVariantId:string;color:string;size:string};
};
export type MarketplacePlan = { kind: 'update' | 'create' | 'family_variants'; targets: Target[]; family?: { reference: string; members: string[] } };

@Injectable()
export class ChatMarketplaceService {
  private readonly locks = new Set<string>();
  private readonly familyVariants: ChatFamilyVariants;
  constructor(private readonly prisma: PrismaService, private readonly auth: MercadoLivreAuthService, private readonly client: MercadoLivreClient,@Optional() private readonly bling?:BlingSyncService) { this.familyVariants = new ChatFamilyVariants(prisma,auth,client); }

  private async canWrite(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { active: true, role: true, permissions:true } });
    if (!user?.active || !effectivePermissions(user).includes('listings.manage')) throw new ForbiddenException('Seu usuário não tem permissão para alterar anúncios.');
  }
  async authorizeFiscal(userId:string){await this.canWrite(userId);}

  private mlb(value: unknown) {
    if (typeof value !== 'string' || !/^MLB\d+$/i.test(value.trim())) throw new BadRequestException('Informe um MLB válido, por exemplo MLB123456789.');
    return value.trim().toUpperCase();
  }

  private string(value: unknown, name: string, max = 180) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BadRequestException(`${name} inválido ou ausente.`);
    return value.trim();
  }

  private quantity(value: unknown) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 999999) throw new BadRequestException('Estoque deve ser um inteiro entre 0 e 999999.');
    return value;
  }

  private price(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 999999999999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001) throw new BadRequestException('Preço deve ser positivo e ter no máximo duas casas decimais.');
    return value;
  }

  private money(value: unknown, currency = 'BRL') {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value));
  }

  private attributes(value: unknown) {
    if (!Array.isArray(value) || !value.length || value.length > 50) throw new BadRequestException('Informe de 1 a 50 atributos.');
    const result = value.map(a => ({ id: this.string(a?.id, 'ID do atributo', 80), value_name: this.string(a?.valor, 'Valor do atributo', 300) }));
    if (new Set(result.map(a => a.id)).size !== result.length) throw new BadRequestException('Há atributos duplicados.');
    return result;
  }

  private photos(value: unknown,maximum=12) {
    if (!Array.isArray(value) || !value.length || value.length > maximum) throw new BadRequestException(`Informe a lista completa de 1 a ${maximum} fotos.`);
    return value.map(v => {
      const source = this.string(v, 'Foto', 2000);
      if (/^\d+-ML[A-Z]\d+_\d+$/.test(source)) return { id: source };
      let url: URL;
      try { url = new URL(source); } catch { throw new BadRequestException('Cada foto deve ser uma URL HTTPS pública ou um ID de foto do Mercado Livre.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) throw new BadRequestException('Use URLs HTTPS públicas para as fotos.');
      return { source };
    });
  }

  private mergeAttributes(current: any[] = [], updates: any[]) {
    const map = new Map(current.map(a => {
      const valueId=a.value_id??a.values?.find((value:any)=>value.id!=null&&String(value.id).trim()!=='')?.id;
      const valueName=a.value_name??a.values?.find((value:any)=>value.name!=null)?.name;
      return [a.id,{id:a.id,...(valueId!=null&&String(valueId).trim()!==''?{value_id:valueId}:{value_name:valueName})}];
    }));
    updates.forEach(a => map.set(a.id, a));
    return [...map.values()];
  }

  private snapshot(item: MeliItemResponse) {
    return {
      id: item.id, seller: item.seller_id, price: item.price, status: item.status,
      quantity: item.available_quantity, title: item.title, familyName: item.family_name,
      updated: item.last_updated, pictures: item.pictures, attributes: item.attributes,
      variations: item.variations, shipping: item.shipping, tags: item.tags, sold: item.sold_quantity
    };
  }

  private fingerprint(item: MeliItemResponse) {
    return createHash('sha256').update(JSON.stringify(this.snapshot(item))).digest('hex');
  }

  private attributeValue(value: any) {
    return { valueId: value?.value_id!=null&&String(value.value_id).trim()!==''?value.value_id:null, valueName: value?.value_name??value?.values?.find((entry:any)=>entry.name!=null)?.name??null };
  }

  private sameValue(left: any, right: any): boolean {
    if (left && right && typeof left === 'object' && 'valueId' in left && 'valueId' in right) {
      return left.valueId != null && right.valueId != null ? String(left.valueId) === String(right.valueId) : left.valueName === right.valueName;
    }
    const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  }

  private mutationState(item: MeliItemResponse, target: Pick<Target, 'body' | 'attributeIds' | 'variationAttributeIds'>) {
    const body = target.body;
    const state: Record<string, any> = { Identidade: [item.id, String(item.seller_id), item.user_product_id ?? null, item.currency_id ?? null] };
    const fields: Record<string, string> = { price: 'Preço', available_quantity: 'Estoque', status: 'Status', title: 'Título', family_name: 'Nome da família' };
    for (const [key, label] of Object.entries(fields)) if (key in body) state[label] = (item as any)[key] ?? null;
    if (body.pictures) state.Fotos = (item.pictures ?? []).map((p: any) => p.id ?? `source:${p.source}`);
    for (const id of target.attributeIds ?? body.attributes?.map((a: any) => a.id) ?? []) {
      state[`Atributo ${id}`] = this.attributeValue(item.attributes?.find(a => a.id === id));
    }
    if (target.attributeIds?.includes('SELLER_SKU')) {
      state['Cor/tamanho do SKU'] = (item.attributes ?? []).filter(a => ['COLOR','SIZE','APPAREL_SIZE','SHOE_SIZE'].includes(a.id)).map(a => ({id:a.id,...this.attributeValue(a)})).sort((a,b) => a.id.localeCompare(b.id));
    }
    if (body.variations) {
      state['Variações do anúncio'] = (item.variations ?? []).filter(v => v.id != null).map(v => String(v.id)).sort();
      for (const planned of body.variations) {
        if (planned.id == null) continue;
        const variant = item.variations?.find(v => String(v.id) === String(planned.id));
        if (planned.available_quantity != null) state[`Estoque da variação ${planned.id}`] = variant?.available_quantity ?? null;
        if (planned.price != null) state[`Preço da variação ${planned.id}`] = variant?.price ?? null;
        if (planned.picture_ids) state[`Fotos da variação ${planned.id}`] = variant?.picture_ids ?? [];
        if (planned.attribute_combinations || target.variationAttributeIds?.[String(planned.id)]?.includes('SELLER_SKU')) state[`Cor/tamanho da variação ${planned.id}`] = [...(variant?.attribute_combinations as any[] ?? []), ...((variant?.attributes as any[] ?? []).filter(a => ['COLOR','SIZE','APPAREL_SIZE','SHOE_SIZE'].includes(a.id)))]
          .map(a => ({id:a.id,...this.attributeValue(a)})).sort((a,b) => a.id.localeCompare(b.id));
        for (const id of target.variationAttributeIds?.[String(planned.id)] ?? planned.attributes?.map((a: any) => a.id) ?? []) {
          state[`Atributo ${id} da variação ${planned.id}`] = this.attributeValue((variant?.attributes as any[])?.find(a => a.id === id));
        }
      }
    }
    return state;
  }

  private guardTarget(item: MeliItemResponse, target: Target): Target {
    const applied: any = { ...item, ...target.body };
    if (target.body.variations) applied.variations = (item.variations ?? []).map(v => {
      const change = target.body.variations.find((planned: any) => String(planned.id) === String(v.id));
      return change ? {...v,...change} : v;
    });
    return { ...target, userProductId: item.user_product_id, baseline: this.mutationState(item,target), desired: this.mutationState(applied,target) };
  }

  private assertCompatible(item: MeliItemResponse, target: Target, kind: MarketplacePlan['kind']) {
    if (kind === 'create' || !target.baseline || !target.desired) {
      if (this.fingerprint(item) !== target.fingerprint) throw new ConflictException('O anúncio mudou desde a prévia. Prepare uma nova proposta antes de confirmar.');
      return;
    }
    const current = this.mutationState(item,target);
    for (const [field, before] of Object.entries(target.baseline)) {
      if(target.standardPrice&&Object.keys(withoutPrice(target.body)).length===0&&(field==='Preço'||field.startsWith('Preço da variação ')))continue;
      if (!this.sameValue(current[field],before) && !this.sameValue(current[field],target.desired[field])) {
        throw new ConflictException(`O anúncio mudou desde a prévia no campo ${field}. Atualize a prévia para confirmar os novos dados.`);
      }
    }
  }

  private rebaseBody(item: MeliItemResponse, target: Target) {
    const body = structuredClone(target.body);
    if (body.attributes && target.attributeIds) body.attributes = this.mergeAttributes(item.attributes,body.attributes.filter((a: any) => target.attributeIds!.includes(a.id)));
    for (const variation of body.variations ?? []) {
      const ids = target.variationAttributeIds?.[String(variation.id)];
      if (variation.attributes && ids) {
        const current = item.variations?.find(v => String(v.id) === String(variation.id));
        variation.attributes = this.mergeAttributes(current?.attributes as any[],variation.attributes.filter((a: any) => ids.includes(a.id)));
      }
    }
    return body;
  }

  private async token(account: SellerAccount) {
    try {
      const token = await this.auth.getValidAccessToken(account.id);
      if (!token) throw new Error();
      return token;
    } catch { throw new ServiceUnavailableException(`Reconecte a conta ${account.name} ao Mercado Livre em Contas conectadas.`); }
  }

  private async target(business: BusinessAccount, mlb: string) {
    const listing = await this.prisma.marketplaceListing.findFirst({
      where: { itemId: mlb, marketplaceAccount: { marketplace: 'MERCADO_LIVRE', businessKey: business.businessKey, active: true } },
      include: { marketplaceAccount: true }
    });
    if (!listing) throw new BadRequestException('Anúncio não encontrado na conta selecionada. Sincronize a conta e confira o MLB.');
    const { id, name, sellerId } = listing.marketplaceAccount;
    const account = { id, name, sellerId };
    let token = await this.token(account);
    let item:MeliItemResponse;
    try{item=await this.client.getItem(token,mlb);}catch(error){if((error as any)?.response?.status!==401)throw this.providerError(error);try{token=await this.auth.getValidAccessToken(account.id,true);item=await this.readItem(token,mlb);}catch(renewError){throw this.providerError(renewError);}}
    this.owner(item, account);
    return { account, item, token };
  }

  async assertSourceWritable(source:{account:{id:string};item:MeliItemResponse}){await assertListingWritable(this.prisma,source.account.id,source.item);}
  async assertWritable(business:BusinessAccount,reference:string){const source=await this.target(business,reference);await assertListingWritable(this.prisma,source.account.id,source.item);return source;}
  private owner(item: MeliItemResponse, account: SellerAccount) {
    if (String(item.seller_id) !== account.sellerId) throw new ForbiddenException('O anúncio não pertence ao vendedor da conta selecionada.');
  }

  private async readItem(token: string, mlb: string) {
    try { return await this.client.getItem(token, mlb); } catch (error) { throw this.providerError(error); }
  }

  private providerError(error: unknown, phase:'read'|'write'='read') {
    if (error instanceof HttpException) return error;
    const status = (error as any)?.response?.status;
    // Expose only error codes, never raw HTTP errors, headers, tokens or payloads.
    const codes = ((error as any)?.response?.data?.cause ?? []).filter((c: any) => c.type !== 'warning').map((c: any) => c.code).filter((c: any) => typeof c === 'string' && /^[\w.:-]{1,100}$/.test(c)).slice(0, 6);
    if(codes.includes('item.attributes.not_modifiable'))return new BadRequestException('O Mercado Livre bloqueou a edição dos atributos desta oferta (item.attributes.not_modifiable). A correção não foi aplicada. Solicite a liberação ou revisão da oferta no próprio Mercado Livre.');
    if((error as any)?.response?.data?.error==='item.price.not_modifiable'||codes.includes('item.price.not_modifiable'))return new BadRequestException('O Mercado Livre recusou a alteração de preço via API (item.price.not_modifiable). Esse erro não confirma, sozinho, uma automatização ativa. Se a Gestão de preços também não mostrar automatização, informe ao suporte do Mercado Livre o MLB e esse código para verificar o bloqueio da edição por API.');
    if (codes.includes('missing.fashion_grid.grid_id.values')) return new BadRequestException('O Mercado Livre exige uma tabela de medidas para esta publicação, mas o modelo não possui uma. Consulte as tabelas disponíveis e peça ao usuário a tabela correta; não escolha medidas de outro produto.');
    if(codes.includes('invalid.fashion_grid.grid_id.values')||codes.includes('invalid.fashion_grid.grid_row_id.values'))return new BadRequestException('A tabela de medidas do anúncio foi recusada pelo Mercado Livre. Confira a compatibilidade do guia e de seus tamanhos com a categoria antes de vincular os SKUs.');
    if (status === 400 || status === 422) return new BadRequestException(`O Mercado Livre recusou os dados${codes.length ? ': ' + codes.join(', ') : '. Confira as regras da categoria e do anúncio.'}`);
    if (status === 401) return new ServiceUnavailableException('O Mercado Livre recusou a autorização (401). Verifique a conexão da conta para renovar ou reconectar.');
    if (status === 403) return new ServiceUnavailableException('O Mercado Livre recusou esta operação (403). Confira as permissões da integração ou as políticas de acesso. Esse erro, sozinho, não confirma que a autorização expirou.');
    if (status === 409) return new ConflictException('O anúncio mudou no Mercado Livre. Consulte novamente e prepare outra proposta.');
    if(status===429)return new ServiceUnavailableException('O Mercado Livre atingiu o limite de consultas. Aguarde um momento e tente novamente.');
    if(status===404)return new BadRequestException('O Mercado Livre não encontrou o anúncio ou o recurso solicitado (404).');
    if(status===405)return new BadRequestException('O Mercado Livre não aceita este método no recurso solicitado (405).');
    if(status===412&&['user_not_authorized','automation_operation_not_allowed'].includes((error as any)?.response?.data?.error))return new BadRequestException('O Mercado Livre não autorizou esta conta a consultar ou gerenciar a automatização de preços (412). Não é possível continuar sem essa permissão.');
    if(Number.isInteger(status)&&status>=500)return new ServiceUnavailableException(`O serviço do Mercado Livre apresentou uma falha (HTTP ${status}). A operação precisa ser conferida antes de repetir.`);
    const code=(error as any)?.code;
    if(['ECONNABORTED','ETIMEDOUT'].includes(code))return new ServiceUnavailableException(phase==='write'?'O Mercado Livre não respondeu dentro do prazo. O sistema não repetiu o envio para evitar duplicação.':'O Mercado Livre não respondeu à consulta dentro do prazo. Tente consultar novamente; essa leitura não altera o anúncio.');
    if(['EACCES','EPERM'].includes(code))return new ServiceUnavailableException('O servidor foi impedido de acessar o Mercado Livre. É necessário corrigir a permissão de rede do servidor.');
    if(['ENOTFOUND','EAI_AGAIN'].includes(code))return new ServiceUnavailableException('O servidor não conseguiu localizar o endereço do Mercado Livre. Verifique o DNS da conexão do servidor.');
    if(['ECONNRESET','ECONNREFUSED'].includes(code))return new ServiceUnavailableException('A conexão com o Mercado Livre foi interrompida. O resultado precisa ser conferido antes de repetir o envio.');
    return new ServiceUnavailableException('Não foi possível obter resposta do Mercado Livre. Verifique a conexão do servidor e tente novamente.');
  }

  async accounts(business: BusinessAccount) {
    return this.prisma.marketplaceAccount.findMany({ where: { marketplace: 'MERCADO_LIVRE', businessKey: business.businessKey, active: true }, select: { id: true, name: true, sellerId: true } });
  }

  private normalize(value: unknown) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  async recall(business: BusinessAccount, requests: string[]) {
    const listings = await this.prisma.marketplaceListing.findMany({
      where: { marketplaceAccount: { marketplace: 'MERCADO_LIVRE', businessKey: business.businessKey, active: true } },
      include: { variants: true }
    });
    const groups = groupListings(listings);
    for (const request of [...requests].reverse()) {
      const text = ` ${this.normalize(request)} `;
      const matches = groups.filter(group => group.children.some((child: any) => {
        const names = [group.title, child.title].map(name => this.normalize(name)).filter(name => name.length >= 12);
        return text.includes(` ${this.normalize(child.itemId)} `) || names.some(name => text.includes(` ${name} `));
      }));
      if (matches.length === 1) return { referencia: matches[0].id, nome: matches[0].title };
      if (matches.length > 1) return null;
    }
    return null;
  }

  private async resolveFamily(business: BusinessAccount, value: unknown) {
    const query = this.string(value, 'Nome ou referência do anúncio', 300);
    const listings = await this.prisma.marketplaceListing.findMany({
      where: { marketplaceAccount: { marketplace: 'MERCADO_LIVRE', businessKey: business.businessKey, active: true } },
      include: { variants: true }
    });
    const groups = groupListings(listings);
    const term = this.normalize(query);
    const exact = groups.filter(g => g.id === query || this.normalize(g.title) === term || g.children.some((c: any) => this.normalize(c.itemId) === term || this.normalize(c.title) === term));
    const matches = exact.length ? exact : groups.filter(g => term.split(' ').every(word => this.normalize([g.title, ...g.children.map((c: any) => c.title)].join(' ')).split(' ').includes(word)));
    if (!matches.length) throw new BadRequestException('Não encontrei esse anúncio na conta selecionada. Confira o nome ou sincronize os anúncios.');
    if (matches.length > 1) throw new BadRequestException(`Encontrei mais de um anúncio. Peça ao usuário para escolher: ${matches.slice(0, 10).map(g => `${g.title} (referência ${g.id})`).join('; ')}.`);
    return matches[0];
  }

  async identify(business: BusinessAccount, value: unknown) {
    const group = await this.resolveFamily(business, value);
    return { referencia: group.id, nome: group.title, mlbs: group.children.map((c: any) => c.itemId),
      variacoes: group.variants.map((v: any) => ({ mlb: v.itemId, id: v.variationId, sku: v.sku,
        atributos: (v.rawData?.attribute_combinations ?? v.attributes?.attribute_combinations ?? v.listingData?.rawData?.attributes ?? [])
          .filter((a: any) => ['COLOR', 'SIZE', 'MAIN_COLOR', 'SECONDARY_COLOR', 'ALPHANUMERIC_SIZE', 'SIZE_GRID_ROW_ID'].includes(a.id))
          .map((a: any) => ({ id: a.id, valor: a.value_name ?? a.value_id })) })),
      observacao: 'Alterar o pai inclui todos os MLBs e todas as variações. Para alterar apenas uma variação, o usuário precisa informar SKU, ID ou cor e tamanho suficientes para identificá-la.' };
  }

  async familyItems(business: BusinessAccount, value: unknown) {
    const group = await this.resolveFamily(business, value);
    const listings = [];
    const moderationReasons=new Map<string,string>();
    const moderationReason=async(token:string,sellerId:string,item:MeliItemResponse)=>{
      if(!item.sub_status?.some(status=>['waiting_for_patch','forbidden'].includes(status)))return undefined;
      if(moderationReasons.has(item.id))return moderationReasons.get(item.id);
      let reason='Confira a pendência em Ver detalhe no Mercado Livre.';
      try{const response=await this.client.getItemModerations(token,sellerId,item.id);reason=response.infractions?.find(entry=>entry.related_item_id===item.id)?.reason||reason;}catch{/* Preserve the known block even if its explanation cannot be fetched. */}
      moderationReasons.set(item.id,reason);return reason;
    };
    let familyVariants: Array<{id:string;sku?:string;cor:string|null;tamanho:string|null;ofertas:Array<{mlb:string;status:string|undefined;estoque:number|undefined;subStatus?:string[];motivoModeracao?:string}>}> | undefined;
    for (const child of group.children) {
      const source = await this.target(business, child.itemId);
      const {item} = source;
      if (item.user_product_id && !familyVariants) {
        const inspected = await this.familyVariants.inspect(source);
        familyVariants=[];
        for(const product of inspected.products){
          const offers=[];
          for(const mlb of await this.client.searchUserProductOffers(source.token,source.account.sellerId,product.id)){
            const offer=await this.client.getItem(source.token,mlb);
            if(String(offer.seller_id)!==source.account.sellerId||offer.user_product_id!==product.id)throw new BadRequestException('Não foi possível confirmar as ofertas da variante na conta selecionada.');
            offers.push({mlb:offer.id,status:offer.status,estoque:offer.available_quantity,subStatus:offer.sub_status,motivoModeracao:await moderationReason(source.token,source.account.sellerId,offer)});
          }
          familyVariants.push({id:product.id,sku:sellerSku(product),cor:product.attributes?.find((a:any)=>a.id==='COLOR')?.values?.[0]?.name??null,tamanho:product.attributes?.find((a:any)=>a.id==='SIZE')?.values?.[0]?.name??null,ofertas:offers});
        }
      }
      const sku = (attributes: any[] = [], fallback?: string) => attributes.find(a => a.id === 'SELLER_SKU')?.value_name || fallback || null;
      listings.push({ mlb: item.id, nome: item.title, preco: item.price, estoque: item.available_quantity, status: item.status,subStatus:item.sub_status,motivoModeracao:await moderationReason(source.token,source.account.sellerId,item),
        modelo: item.user_product_id || item.family_name ? 'USER_PRODUCTS' : 'TRADICIONAL',
        variacoes: item.variations?.length ? item.variations.map(v => ({ id: String(v.id), sku: sku(v.attributes as any[], v.seller_custom_field), estoque: v.available_quantity, atributos: v.attribute_combinations }))
          : [{ id: item.id, sku: sku(item.attributes, item.seller_custom_field), estoque: item.available_quantity, atributos: item.attributes?.filter(a => ['COLOR', 'SIZE'].includes(a.id)) }] });
    }
    const prices = [...new Set(listings.map(listing => listing.preco))];
    return { referencia: group.id, nome: group.title, anuncios: listings, variantesDaFamilia:familyVariants, precosExistentes: prices,
      precoUnico: prices.length === 1 ? prices[0] : null, precisaEscolherReferenciaPreco: prices.length > 1,
      observacaoPublicacao:'Uma variante cadastrada na família não é uma oferta publicada. Apenas ofertas com status active e estoque positivo foram confirmadas como ativas. Ausência de oferta não significa ausência de variante.' };
  }
  async refreshFiscalToken(accountId:string){return this.auth.getValidAccessToken(accountId,true);}
  async fiscalSources(business:BusinessAccount,reference:string,readOnly=false){
    const group=await this.resolveFamily(business,reference);
    const sources=[];
    for(const child of group.children){
      // Fiscal identity must reflect completed SKU corrections, even before the next catalog sync.
      sources.push(await this.target(business,child.itemId));
    }
    return sources;
  }

  async chartSource(business:BusinessAccount,reference:string){
    const group=await this.resolveFamily(business,reference);const match=group.children.find((child:any)=>this.normalize(child.itemId)===this.normalize(reference)||this.normalize(child.title)===this.normalize(reference));return this.target(business,match?.itemId??group.children[0].itemId);
  }

  async chartPolicy(business:BusinessAccount,reference:string){const source=await this.chartSource(business,reference);return sizeChartPolicy(this.client,source.token,source.item);}

  async sizeCharts(business:BusinessAccount,reference:string,sizes:string[]=[]){
    try{
    const group=await this.resolveFamily(business,reference);
    const match=group.children.find((child:any)=>this.normalize(child.itemId)===this.normalize(reference)||this.normalize(child.title)===this.normalize(reference));
    const source=await this.target(business,match?.itemId??group.children[0].itemId);
    const inherited=source.item.attributes?.find(a=>a.id==='SIZE_GRID_ID')?.value_name;
    return {modelMlb:source.item.id,currentChartId:inherited??null,charts:await new ChatSizeCharts(this.client,await createdSizeCharts(this.prisma,business.id,source.item.id)).list(source,sizes)};
    }catch(error){throw this.providerError(error);}
  }

  async prepareNamedUpdate(business: BusinessAccount, userId: string, args: any): Promise<MarketplacePlan> {
    if (!['pai', 'variacao'].includes(args.escopo)) throw new BadRequestException('Informe se deseja alterar o pai ou uma variação.');
    if (args.escopo === 'variacao' && !args.variacao?.trim()) throw new BadRequestException('Qual variação você quer alterar? Informe o SKU, ID ou a cor e o tamanho.');
    const group = await this.resolveFamily(business, args.anuncio);
    let variants = group.variants;
    if (args.escopo === 'variacao') {
      const term = this.normalize(args.variacao);
      const exact = variants.filter((v: any) => [v.sku, v.variationId, v.itemId].some(value => this.normalize(value) === term));
      variants = exact.length ? exact : variants.filter((v: any) => {
        const attributes = v.rawData?.attribute_combinations ?? v.attributes?.attribute_combinations ?? v.listingData?.rawData?.attributes ?? [];
        const values = this.normalize(attributes.map((a: any) => a.value_name).join(' ')).split(' ');
        return term.split(' ').every(word => values.includes(word));
      });
      if (variants.length !== 1) throw new BadRequestException('A variação não foi identificada de forma única. Informe o SKU ou o ID exato, ou a cor e o tamanho completos.');
    }
    const mlbs = [...new Set<string>(variants.map((v: any) => v.itemId))];
    const plans: MarketplacePlan[] = [];
    for (const mlb of mlbs) {
      const variant = variants.find((v: any) => v.itemId === mlb);
      const legacy = variant.listingData?.variants?.length > 0;
      if (args.escopo === 'variacao' && legacy && ['preco', 'status', 'titulo', 'descricao', 'fotos', 'atributos'].some(key => args[key] != null)) {
        throw new BadRequestException('Este anúncio tradicional compartilha esses campos entre as variações. Para mudar apenas uma variação, solicite o estoque; para os demais campos, solicite a alteração do pai.');
      }
      plans.push(await this.prepareUpdates(business, userId, [{ ...args, mlb,
        variacao_id: args.escopo === 'variacao' && legacy ? variant.variationId : null }], args.escopo === 'pai'));
    }
    const targets = plans.flatMap(plan => plan.targets);
    targets.forEach(target => target.preview.notes.unshift(args.escopo === 'pai'
      ? `Anúncio pai: ${group.title}. Esta proposta inclui todas as ${group.variants.length} variações em ${group.children.length} MLB(s).${args.estoque != null ? ' Estoque informado é aplicado a cada variação.' : ''}`
      : `Somente a variação solicitada: ${args.variacao}.`));
    return { kind: 'update', targets, family: { reference: group.id, members: group.children.map((c: any) => c.itemId).sort() } };
  }

  async inspect(business: BusinessAccount, value: unknown) {
    if (typeof value === 'string' && !/^MLB\d+$/i.test(value.trim())) return this.identify(business, value);
    const { item, account, token } = await this.target(business, this.mlb(value));
    let description;
    try { description = await this.client.getDescription(token, item.id); } catch (error) { throw this.providerError(error); }
    return {
      mlb: item.id, conta: account.name, nome: item.title, nomeFamilia: item.family_name,
      preco: item.price, moeda: item.currency_id, estoque: item.available_quantity, status: item.status,
      vendidos: item.sold_quantity, categoria: item.category_id, userProduct: item.user_product_id,
      fotos: item.pictures?.map(p => ({id:p.id,url:p.secure_url ?? p.url})), atributos: item.attributes?.map(a => ({id:a.id,valor:a.value_name,idValor:a.value_id})), descricao: description?.plain_text ?? '',
      variacoes: (item.variations ?? []).map(v => ({ id: String(v.id), estoque: v.available_quantity, sku: (v.attributes as any[])?.find(a => a.id === 'SELLER_SKU')?.value_name || v.seller_custom_field,
        atributos: (v.attribute_combinations as any[])?.map(a => ({id:a.id,valor:a.value_name})), fotos: v.picture_ids })),
      observacao: 'Consulta ao vivo. Alterações só serão enviadas após confirmação da proposta.'
    };
  }

  async category(business: BusinessAccount, value: unknown) {
    const id = this.string(value, 'Categoria');
    if (!/^MLB\d+$/.test(id)) throw new BadRequestException('Informe um ID de categoria MLB válido.');
    const account = (await this.accounts(business))[0];
    if (!account) throw new BadRequestException('Conecte uma conta Mercado Livre.');
    try {
      const data = await this.client.category(await this.token(account), id);
      return { id, nome: data.category.name, regras: data.category.settings,
        atributos: data.attributes.filter(a => a.tags?.required || a.tags?.conditional_required || a.tags?.allow_variations).map(a => ({ id: a.id, nome: a.name, tags: a.tags, valores: a.values?.slice(0, 20) })) };
    } catch (error) { throw this.providerError(error); }
  }

  private async restrictions(item: MeliItemResponse, account: SellerAccount, token: string, body: Record<string, any>,approvedRemoval?:Target['removeAutomation']) {
    const skuAttributesOnly = (attributes: any[], existing: any[]) => {
      if (!Array.isArray(attributes) || !attributes.some(attribute => attribute.id === 'SELLER_SKU')) return false;
      const withoutSku = (values: any[]) => this.mergeAttributes(values, []).filter(attribute => attribute.id !== 'SELLER_SKU').sort((a,b) => a.id.localeCompare(b.id));
      return JSON.stringify(withoutSku(attributes)) === JSON.stringify(withoutSku(existing));
    };
    const skuOnly = Object.keys(body).length > 0 && Object.keys(body).every(key => ['attributes','variations'].includes(key))
      && (!body.attributes || skuAttributesOnly(body.attributes, item.attributes ?? []))
      && (!body.variations || (Array.isArray(body.variations) && body.variations.length > 0 && body.variations.every((variation:any) => {
        const existing = item.variations?.find(row => String(row.id) === String(variation.id));
        return !!existing && Object.keys(variation).every(key => ['id','attributes'].includes(key)) && (!variation.attributes || skuAttributesOnly(variation.attributes, existing.attributes as any[] ?? []));
      })));
    const correctiveIds=new Set(['BRAND','MODEL']);
    const withoutCorrections=(attributes:any[])=>this.mergeAttributes(attributes,[]).filter(attribute=>!correctiveIds.has(attribute.id)).sort((a,b)=>a.id.localeCompare(b.id));
    const identityCorrection=item.sub_status?.includes('waiting_for_patch')&&['inactive','under_review'].includes(item.status??'')
      &&Object.keys(body).length===1&&Array.isArray(body.attributes)&&body.attributes.some((attribute:any)=>correctiveIds.has(attribute.id))
      &&JSON.stringify(withoutCorrections(body.attributes))===JSON.stringify(withoutCorrections(item.attributes??[]));
    if (!['active', 'paused'].includes(item.status ?? '') && !(item.status === 'under_review' && skuOnly)&&!identityCorrection) throw new BadRequestException(`O anúncio ${item.id} está com status ${item.status}. Anúncios com correção pendente permitem somente corrigir marca/modelo; outras alterações exigem anúncio ativo ou pausado.`);
    if (body.price !== undefined) {
      let automation;
      try { automation = await this.client.getPriceAutomation(token, item.id,!!approvedRemoval||item.tags?.includes('dynamic_standard_price')); } catch (error) { throw this.providerError(error); }
      if(automation&&approvedRemoval){
        if((automation.item_id??item.id)!==approvedRemoval.mlb||(automation.item_rule?.rule_id??'')!==approvedRemoval.ruleId||(automation.min_price??null)!==approvedRemoval.minPrice||(automation.max_price??null)!==approvedRemoval.maxPrice)throw new ConflictException('A regra de automatização mudou. Prepare outra prévia antes de desativar.');
        const source=approvedRemoval.mlb===item.id?item:await this.readItem(token,approvedRemoval.mlb);this.owner(source,account);
      }
      if ((automation?.status === 'ACTIVE'||item.tags?.includes('dynamic_standard_price'))&&!approvedRemoval) throw new BadRequestException('O anúncio tem automatização de preços ativa. Prepare uma prévia que informe sua desativação antes de aplicar um preço fixo.');
    }
    if (body.available_quantity !== undefined || body.variations?.some((v: any) => v.available_quantity !== undefined)) {
      if (item.shipping?.logistic_type === 'fulfillment') throw new BadRequestException('O estoque Full é gerenciado pelo Mercado Livre e não pode ser alterado pelo chat.');
      let seller;
      try { seller = await this.client.getSeller(token, account.sellerId); } catch (error) { throw this.providerError(error); }
      const zeroStockCreation=body.available_quantity===undefined&&body.variations?.every((v:any)=>v.available_quantity===undefined||v.id==null&&v.available_quantity===0);
      if (seller.tags?.includes('warehouse_management')&&!zeroStockCreation) throw new BadRequestException('Esta conta usa estoque por depósito. Atualize o estoque por depósito no Mercado Livre; o chat não altera esse estoque agregado.');
    }
    if (body.title !== undefined && Number(item.sold_quantity) > 0) throw new BadRequestException('Este anúncio já tem vendas; a alteração de título precisa ser feita conforme as regras do Mercado Livre.');
  }

  async prepareUpdates(business: BusinessAccount, userId: string, changes: unknown, entireParent = false): Promise<MarketplacePlan> {
    await this.canWrite(userId);
    if (!Array.isArray(changes) || !changes.length || changes.length > 20) throw new BadRequestException('Informe de 1 a 20 anúncios por proposta.');
    const targets: Target[] = [];
    const seen = new Set<string>();
    for (const change of changes) {
      const mlb = this.mlb(change?.mlb);
      if (seen.has(mlb)) throw new BadRequestException('Agrupe as mudanças de cada MLB em uma única entrada.');
      seen.add(mlb);
      const { item, account, token } = await this.target(business, mlb);
      const body: Record<string, any> = {};
      let attributeIds: string[] | undefined;
      let standardPrice:Target['standardPrice'];
      let removeAutomation:Target['removeAutomation'];
      const fields: PreviewField[] = [];
      const notes: string[] = [];
      const add = (field: string, before: unknown, after: unknown) => fields.push({ field, before: String(before ?? '—'), after: String(after) });
      if (change.preco != null) {
        body.price = this.price(change.preco);
        if (item.currency_id !== 'BRL') throw new BadRequestException('O chat altera preços apenas em reais (BRL).');
        const before=standardPrices(await this.client.getItemPrices(token,item.id),item.currency_id);
        standardPrice={before,prices:proposedPrices(before,body.price)};
        notes.push('O anúncio e seus preços serão consultados ao vivo antes de aplicar o valor confirmado. A alteração será enviada pelo método de edição de anúncios disponível no Mercado Livre.');
        const marketplacePrice=before.find(row=>!row.conditions.context_restrictions.length||row.conditions.context_restrictions.includes('channel_marketplace'))!;
        add('Preço', this.money(marketplacePrice.amount), this.money(body.price));
        const previousBlocks=await this.prisma.auditLog.findMany({where:{action:'CHAT_ML_UPDATE_DETAIL',entityId:item.id,userId},orderBy:{createdAt:'desc'},take:5,select:{after:true}});
        const previouslyBlocked=previousBlocks.some(record=>/bloqueou a edição manual do preço|item\.price\.not_modifiable/.test(String((record.after as any)?.message??'')));
        const strictAutomation=!!item.tags?.includes('dynamic_standard_price')||previouslyBlocked;
        const automation=await this.client.getPriceAutomation(token,item.id,strictAutomation);
        if(automation&&['ACTIVE','PAUSED'].includes(automation.status)){
          if(!automation.item_rule?.rule_id)throw new BadRequestException('Não foi possível identificar a regra de automatização para preparar sua desativação.');
          const automatedMlb=this.mlb(automation.item_id??item.id);const automatedItem=automatedMlb===item.id?item:await this.readItem(token,automatedMlb);this.owner(automatedItem,account);
          removeAutomation={mlb:automatedMlb,ruleId:automation.item_rule.rule_id,minPrice:automation.min_price??null,maxPrice:automation.max_price??null};
          add('Automatização de preços',`${automation.status==='ACTIVE'?'Ativa':'Pausada'} · regra ${removeAutomation.ruleId}`,'Desativar e definir o preço fixo informado');
          notes.push('Ao confirmar, você autoriza desativar a automatização antes de aplicar o preço fixo. Ela não será reativada automaticamente.');
          if(automatedMlb!==item.id)notes.push(`A regra está no anúncio de catálogo vinculado ${automatedMlb}. Sua desativação pode afetar os anúncios sincronizados com ele.`);
        }else if(strictAutomation){
          let sellerDiagnosis='A consulta da lista de automatizações do vendedor não foi concluída.';
          let confirmedAbsent=false;
          try{
            const automatedItems=await this.client.getSellerPriceAutomationItems(token,account.sellerId);
            confirmedAbsent=!automatedItems.includes(item.id)&&!item.tags?.includes('dynamic_standard_price');
            sellerDiagnosis=automatedItems.includes(item.id)?'O anúncio consta na lista de automatizações do vendedor, mas sua regra individual não foi retornada.':'O anúncio também não consta na lista de automatizações do vendedor. Há divergência entre o bloqueio de preço e as consultas de automatização do Mercado Livre.';
          }catch(error){const status=(error as any)?.response?.status;if(status===401||status===403||status===412)throw this.providerError(error);}
          if(!confirmedAbsent)throw new BadRequestException(`O Mercado Livre recusou a edição de preço anteriormente (item.price.not_modifiable), mas a consulta da regra retornou automation_not_found (404). ${sellerDiagnosis} Não foi confirmada falta de permissão. Nenhum novo preço foi enviado e nenhuma automatização foi removida.`);
          notes.push('Houve uma recusa anterior de preço, mas as consultas atuais não indicam automatização neste anúncio. Ao confirmar, será feita uma nova tentativa de edição e o resultado será conferido no Mercado Livre.');
        }
        if (item.original_price) notes.push('Este anúncio tem preço promocional. A proposta altera o preço informado no anúncio; confira o preço de venda e as ofertas depois.');
        if (item.variations?.length) {
          // Legacy variations share one price; always include all IDs.
          body.variations = item.variations.map(v => ({ id: v.id, price: body.price }));
          notes.push('O preço se aplica a todas as variações deste anúncio.');
        }
      }
      if (change.estoque != null) {
        const quantity = this.quantity(change.estoque);
        if (item.variations?.length) {
          body.variations ??= item.variations.map(v => ({ id: v.id }));
          const selected = entireParent ? item.variations : item.variations.filter(v => String(v.id) === String(change.variacao_id));
          if (!selected.length) throw new BadRequestException('Informe o ID da variação para alterar estoque de um anúncio com variações.');
          for (const variant of selected) {
            body.variations.find((v: any) => String(v.id) === String(variant.id)).available_quantity = quantity;
            add(`Estoque da variação ${variant.id}`, variant.available_quantity, quantity);
          }
        } else {
          if (change.variacao_id) throw new BadRequestException('Este anúncio não tem a variação informada.');
          body.available_quantity = quantity;
          add('Estoque', item.available_quantity, quantity);
        }
        notes.push('Estoque zero pode pausar o anúncio. Repor estoque pode reativar um anúncio sem estoque.');
      }
      if (change.status != null) {
        if (!['active', 'paused'].includes(change.status)) throw new BadRequestException('Status permitido: active ou paused.');
        body.status = change.status;
        add('Status', item.status === 'active' ? 'Ativo' : 'Pausado', change.status === 'active' ? 'Ativo' : 'Pausado');
      }
      if (change.titulo != null) {
        const title = this.string(change.titulo, 'Título', 120);
        const field = item.family_name ? 'family_name' : 'title';
        body[field] = title;
        add('Título / nome da família', item.family_name || item.title, title);
      }
      if (change.fotos != null) {
        body.pictures = this.photos(change.fotos,item.variations?.length?Math.min(6000,item.variations.length*12):12);
        const replaced=new Set(Array.isArray(change.fotos_variacoes)?change.fotos_variacoes.map((v:any)=>String(v.id)):[]);
        const references = (item.variations ?? []).filter(v=>!replaced.has(String(v.id))).flatMap(v => v.picture_ids ?? []);
        if (references.some(id => !body.pictures.some((p: any) => p.id === id))) throw new BadRequestException('Preserve os IDs de fotos usados pelas variações na lista completa de fotos.');
        add('Fotos (lista completa)', JSON.stringify(item.pictures?.map(p => p.id) ?? []), JSON.stringify(body.pictures));
      }
      if(change.fotos_variacoes!==undefined){
        if(!Array.isArray(change.fotos_variacoes)||!change.fotos_variacoes.length||change.fotos_variacoes.length>500||!body.pictures)throw new BadRequestException('Informe as variações e a lista completa de fotos do anúncio.');
        const seenVariations=new Set<string>();
        body.variations??=item.variations?.map(v=>({id:v.id}));
        for(const entry of change.fotos_variacoes){
          const id=String(entry.id),current=item.variations?.find(v=>String(v.id)===id);
          if(!current||seenVariations.has(id))throw new BadRequestException('Variação inválida ou repetida para editar fotos.');seenVariations.add(id);
          const pictures=this.photos(entry.fotos);
          if(pictures.some((p:any)=>!p.id||!body.pictures.some((root:any)=>root.id===p.id)))throw new BadRequestException('As fotos da variação precisam constar na galeria do anúncio.');
          const target=body.variations.find((v:any)=>String(v.id)===id);target.picture_ids=pictures.map((p:any)=>p.id);
          add('Fotos da variação '+id,JSON.stringify(current.picture_ids??[]),JSON.stringify(target.picture_ids));
        }
      }
      if (change.atributos != null) {
        const updates = this.attributes(change.atributos);
        attributeIds = updates.map(attribute => attribute.id);
        body.attributes = this.mergeAttributes(item.attributes, updates);
        for (const attr of updates) add(`Atributo ${attr.id}`, item.attributes?.find(a => a.id === attr.id)?.value_name, attr.value_name);
      }
      let description: string | undefined;
      let descriptionBefore: string | null | undefined;
      if (change.descricao != null) {
        description = this.string(change.descricao, 'Descrição', 10000);
        if (/<\/?[a-z][^>]*>/i.test(description)) throw new BadRequestException('A descrição deve conter texto simples, sem HTML.');
        try { descriptionBefore = (await this.client.getDescription(token, mlb))?.plain_text ?? null; } catch (error) { throw this.providerError(error); }
        add('Descrição completa', descriptionBefore, description);
      }
      if (!fields.length) throw new BadRequestException('Informe pelo menos uma alteração para cada anúncio.');
      const resultingQuantity = item.variations?.length ? item.variations.reduce((sum, v) => sum + (body.variations?.find((planned: any) => String(planned.id) === String(v.id))?.available_quantity ?? v.available_quantity ?? 0), 0)
        : body.available_quantity ?? item.available_quantity ?? 0;
      if (body.status === 'active' && resultingQuantity === 0) throw new BadRequestException('Não é possível reativar um anúncio sem estoque.');
      await this.restrictions(item, account, token, body,removeAutomation);
      if (item.user_product_id && ['available_quantity', 'family_name', 'pictures', 'attributes'].some(key => key in body)) notes.push(`Características e estoque podem ser compartilhados com outros anúncios do mesmo produto ${item.user_product_id}.`);
      if (description !== undefined && Object.keys(body).length) notes.push('A alteração do anúncio e da descrição será enviada em etapas. Confira os resultados individuais se ocorrer uma falha.');
      await this.saveLocal(account,item);
      targets.push(this.guardTarget(item,{ account, mlb, fingerprint: this.fingerprint(item), before: this.auditSnapshot(item), body, description, descriptionBefore, attributeIds,standardPrice,removeAutomation,
        preview: { mlb, title: item.title ?? mlb, account: account.name, fields, notes } }));
    }
    return { kind: 'update', targets };
  }

  private async validateCatalogSku(business: BusinessAccount, sku: string, attributes: any[]) {
    const row = await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:business.id,sku}}});
    if (row) assertCatalogAttributes(row,attributes);
  }

  async prepareFamilyVariants(business: BusinessAccount, userId: string, args: any): Promise<MarketplacePlan> {
    await this.canWrite(userId);
    const group = await this.resolveFamily(business,args.anuncio);
    const source = await this.target(business,group.children.find((child:any) => child.itemId === String(args.anuncio).trim().toUpperCase())?.itemId ?? group.children[0].itemId);
    if (source.item.user_product_id || source.item.family_name) return this.familyVariants.prepare(business,source,args.variacoes);
    // Choose the API from live item data, not from the tool selected by the AI.
    if (!Array.isArray(args.variacoes) || !args.variacoes.length || args.variacoes.length > MAX_VARIATION_SELECTION) throw new BadRequestException('Informe de 1 a 1000 variações.');
    const template = source.item.variations?.[0];
    if (!template) throw new BadRequestException('O anúncio tradicional precisa ter uma variação modelo com atributos de cor e tamanho.');
    const modelSku = sellerSku(template);
    const modelRow = modelSku ? await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:business.id,sku:modelSku}}}) : null;
    if (!modelRow) throw new BadRequestException('O SKU da variação modelo não foi encontrado na Bling desta conta. Confira o vínculo do pai.');
    const rows = [];
    for (const requested of args.variacoes) {
      const sku = this.string(requested.sku,'SKU',100);
      const row = await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:business.id,sku}}});
      if (!row || row.productId !== modelRow.productId || !row.color || !row.size) throw new BadRequestException(`O SKU ${sku} não pertence ao produto Bling deste pai ou não possui cor e tamanho.`);
      rows.push(row);
    }
    if (new Set(rows.map(row => row.sku)).size !== rows.length) throw new BadRequestException('Há SKUs repetidos na preparação das variações.');
    await applySharedStock(this.prisma,rows);
    if (rows.some(row => !Number.isSafeInteger(row.stock))) throw new BadRequestException('O estoque Bling de uma variação está indisponível. Consulte ou sincronize o estoque antes de preparar a prévia.');
    if (rows.some(row => !Number.isSafeInteger(row.stock))) throw new BadRequestException('O estoque Bling de uma variação está indisponível. Consulte ou sincronize o estoque antes de preparar a prévia.');
    const seller=await this.client.getSeller(source.token,source.account.sellerId);
    let warehouse:Target['additionWarehouse'];
    if(seller.tags?.includes('warehouse_management')){
      const stores=(await this.client.getWarehouses(source.token,source.account.sellerId)).filter(store=>String(store.user_id)===source.account.sellerId&&store.status==='active'&&store.tags?.includes('stock_location')&&store.network_node_id);
      if(stores.length!==1)throw new BadRequestException('Escolha um depósito ativo único antes de adicionar as variações.');
      warehouse={store_id:String(stores[0].id),network_node_id:String(stores[0].network_node_id)};
    }
    const modelChart=source.item.attributes?.find(attribute=>attribute.id==='SIZE_GRID_ID');
    const chartId=args.size_chart_id||modelChart?.value_name||modelChart?.value_id;
    const selectedChart=chartId?await new ChatSizeCharts(this.client,await createdSizeCharts(this.prisma,business.id,source.item.id)).select(source,String(chartId),[...rows.map(row=>row.size!),...(source.item.variations??[]).map(row=>(row.attribute_combinations as any[])?.find((attribute:any)=>attribute.id==='SIZE')?.value_name).filter((size):size is string=>typeof size==='string')]):undefined;
    const plan = await this.prepareVariations(business,userId,{mlb:source.item.id,variacoes:rows.map((row,index) => ({id:null,sku:row.sku,estoque:warehouse?0:Math.max(0,row.stock),
      atributos:[...(template.attribute_combinations as any[] ?? []).filter(a => !['COLOR','SIZE'].includes(a.id)).map(a => ({id:a.id,valor:a.value_name})),{id:'COLOR',valor:variantColorName(row.color!)},{id:'SIZE',valor:row.size}],
      fotos:args.variacoes[index].fotos ?? template.picture_ids ?? source.item.pictures?.map(p => p.id)}))});
    plan.targets[0].preview.notes.push('Formato identificado ao vivo: tradicional. As novas variações usam SKU, cor, tamanho e estoque do catálogo Bling, com o preço compartilhado do anúncio. Confira as fotos herdadas antes de confirmar.');
    plan.targets[0].refreshBlingStockForAdditions=true;
    if(selectedChart){
      const target=plan.targets[0];target.body.attributes=this.mergeAttributes(source.item.attributes,[{id:'SIZE_GRID_ID',value_name:selectedChart.id}]);target.attributeIds=['SIZE_GRID_ID'];
      for(const addition of target.body.variations.filter((row:any)=>row.id==null)){const size=addition.attribute_combinations.find((attribute:any)=>attribute.id==='SIZE')?.value_name;const rowId=selectedChart.rows[chartSizeKey(size)];if(!rowId)throw new BadRequestException('A tabela selecionada nao possui a linha de medidas de '+size+'. Nenhuma variacao foi enviada.');addition.attributes.push({id:'SIZE_GRID_ROW_ID',value_name:rowId});}
      for(const existing of target.body.variations.filter((row:any)=>row.id!=null)){const current=source.item.variations?.find(row=>String(row.id)===String(existing.id));const size=(current?.attribute_combinations as any[])?.find((attribute:any)=>attribute.id==='SIZE')?.value_name;const gridRow=selectedChart.rows[chartSizeKey(size)];if(!gridRow)throw new BadRequestException('A tabela não atende uma variação existente do anúncio.');existing.attributes=this.mergeAttributes(current?.attributes as any[],[{id:'SIZE_GRID_ROW_ID',value_name:gridRow}]);target.variationAttributeIds??={};target.variationAttributeIds[String(existing.id)]=['SIZE_GRID_ROW_ID'];}
      target.preview.notes.push('A tabela escolhida será associada ao anúncio e a todos os seus tamanhos, incluindo os já existentes. Confira as medidas antes de confirmar.');
      target.preview.fields.push({field:'Tabela de medidas',before:source.item.attributes?.find(attribute=>attribute.id==='SIZE_GRID_ID')?.value_name??'Não informada',after:`${selectedChart.name} · ID ${selectedChart.id}`});
      plan.targets[0]=this.guardTarget(source.item,target);
    }
    if(warehouse){plan.targets[0].additionWarehouse=warehouse;plan.targets[0].preview.notes.push('As novas variações são incluídas juntas neste anúncio com estoque inicial zero; em seguida, cada estoque real Bling é vinculado ao depósito. As variações atuais são preservadas.');}
    plan.targets[0].preview.notes.push('O estoque de cada nova variação será consultado ao vivo na Bling antes do envio. Estoque negativo é tratado como zero.');
    return plan;
  }

  private async assertSkuCorrectionChart(token:string,item:MeliItemResponse){
    const chartId=item.attributes?.find(attribute=>attribute.id==='SIZE_GRID_ID')?.value_name;
    if(!chartId||!item.domain_id)return;
    const chart=await this.client.getSizeChart(token,chartId);
    const domain=(value:string)=>value.replace(/^ML[A-Z]-/,'').toUpperCase();
    if(chart.domain_id&&domain(chart.domain_id)!==domain(item.domain_id))throw new BadRequestException(`${item.id}: a tabela de medidas ${chartId} não é compatível com a categoria deste anúncio. Corrija a tabela no Mercado Livre antes de vincular os SKUs. Nenhuma alteração foi enviada.`);
  }
  async prepareCatalogSkuCorrection(business:BusinessAccount,userId:string,reference:string,rows:Array<{sku:string;cor:string|null;tamanho:string|null}>,choices:Array<{mlb:string;variationId:string;sku:string}>=[],skipped:Array<{mlb:string;variationId:string}>=[]):Promise<MarketplacePlan>{
    await this.canWrite(userId);
    const sources=await this.fiscalSources(business,reference);const targets:Target[]=[];
    for(const {item,account,token} of sources){
      if((item as any).sub_status?.includes('deleted'))continue;
      const fields:PreviewField[]=[];const body:any={};const variationAttributeIds:Record<string,string[]>={};
      for(const variant of item.variations?.length?item.variations:[item]){
        if(skipped.some(row=>row.mlb===item.id&&row.variationId===(variant===item?'':String(variant.id))))continue;
        const choice=choices.find(row=>row.mlb===item.id&&row.variationId===(variant===item?'':String(variant.id)));
        const dimensions=skuListingDimensions(variant);
        const match=choice?rows.find(row=>row.sku===choice.sku):correspondingVariant(rows,dimensions.color,dimensions.size);
        if(choice && match && dimensions.size && !sameSize(dimensions.size,match.tamanho))throw new BadRequestException('O tamanho do SKU escolhido difere do tamanho do anúncio.');
        if(!match)throw new BadRequestException(`Não foi possível identificar um SKU único na Bling para ${item.id}, cor ${dimensions.color}, tamanho ${dimensions.size}. Confira a cor e o tamanho antes de corrigir.`);
        const sku=match.sku;if(sellerSku(variant)===sku)continue;
        const attributes=this.mergeAttributes(variant.attributes as any[],[{id:'SELLER_SKU',value_name:sku}]);
        if(variant===item)body.attributes=attributes;
        else{body.variations??=item.variations!.map(row=>({id:row.id}));body.variations.find((row:any)=>row.id===variant.id).attributes=attributes;variationAttributeIds[String(variant.id)]=['SELLER_SKU'];}
        fields.push({field:`SKU · ${dimensions.color} · tamanho ${dimensions.size}`,before:sellerSku(variant)??'Não informado',after:sku});
      }
      if(!fields.length)continue;
      if(item.variations?.length&&body.variations&&sellerSku(item)&&!skipped.some(row=>row.mlb===item.id)){
        body.attributes=this.mergeAttributes(item.attributes,[{id:'SELLER_SKU',value_name:null}]);
        fields.unshift({field:'SKU antigo no anúncio pai',before:sellerSku(item)!,after:'Remover do nível pai; os SKUs corretos serão aplicados a cada variação.'});
      }
      await this.assertSkuCorrectionChart(token,item);
      await this.restrictions(item,account,token,body);
      targets.push(this.guardTarget(item,{account,mlb:item.id,fingerprint:this.fingerprint(item),before:this.auditSnapshot(item),body,variationAttributeIds,...(body.attributes?{attributeIds:['SELLER_SKU']}:{}),preview:{mlb:item.id,title:item.title??item.id,account:account.name,fields,notes:['O SKU base identifica o produto Bling. Cada cor e tamanho recebe seu próprio SKU, sem alteração de preço ou estoque. Confirme esta correção antes de preparar as variações ausentes.']}}));
    }
    return {kind:'update',targets};
  }
  async prepareVariations(business: BusinessAccount, userId: string, args: any): Promise<MarketplacePlan> {
    await this.canWrite(userId);
    const { account, token, item } = await this.target(business, this.mlb(args.mlb));
    if (item.user_product_id || item.family_name) {
      if (!Array.isArray(args.variacoes) || args.variacoes.some((v:any) => v.id != null)) throw new BadRequestException('A edição de variantes User Products exige identificação própria. Para adicionar, use SKUs novos com ID vazio.');
      return this.familyVariants.prepare(business,{account,token,item},args.variacoes);
    }
    if (!item.variations?.length) throw new BadRequestException('Use um anúncio tradicional que já tenha variações como modelo.');
    if (!Array.isArray(args.variacoes) || !args.variacoes.length || args.variacoes.length > MAX_VARIATION_SELECTION) throw new BadRequestException('Informe de 1 a 1000 variações.');
    const variations: any[] = item.variations.map(v => ({ id: v.id }));
    const fields: PreviewField[] = [];
    const ids = new Set<string>();
    const variationAttributeIds: Record<string,string[]> = {};
    for (const v of args.variacoes) {
      const quantity = this.quantity(v.estoque);
      const combinations = this.attributes(v.atributos);
      await this.validateCatalogSku(business,this.string(v.sku,'SKU',100),combinations);
      if (v.id == null && item.variations.some(existing => sellerSku(existing) === v.sku)) throw new BadRequestException('Este SKU já existe no anúncio; não é permitido duplicá-lo.');
      const photos = v.fotos;
      if (!Array.isArray(photos) || !photos.length || photos.some(p => !item.pictures?.some(existing => existing.id === p))) throw new BadRequestException('Use IDs de fotos já presentes no anúncio para cada variação.');
      const data: any = { available_quantity: quantity, price: item.price, attribute_combinations: combinations, picture_ids: photos,
        attributes: [{ id: 'SELLER_SKU', value_name: this.string(v.sku, 'SKU', 100) }] };
      if (v.id != null) {
        const current = item.variations.find(existing => String(existing.id) === String(v.id));
        if (!current || ids.has(String(v.id))) throw new BadRequestException('ID de variação inexistente ou duplicado.');
        ids.add(String(v.id));
        variationAttributeIds[String(v.id)] = ['SELLER_SKU'];
        data.id = current.id;
        variations[variations.findIndex(existing => String(existing.id) === String(v.id))] = { ...data, attributes: this.mergeAttributes(current.attributes as any[], data.attributes) };
        fields.push({ field: `Variação ${v.id}`, before: JSON.stringify({ estoque: current.available_quantity, atributos: current.attribute_combinations }), after: JSON.stringify(data) });
      } else {
        variations.push(data);
        fields.push({ field: 'Nova variação', before: 'Não existe', after: JSON.stringify(data) });
      }
    }
    const body = { variations };
    await this.restrictions(item, account, token, body);
    await this.saveLocal(account,item);
    return { kind: 'update', targets: [this.guardTarget(item,{ account, mlb: item.id, fingerprint: this.fingerprint(item), before: this.auditSnapshot(item), body, variationAttributeIds,
      preview: { mlb: item.id, title: item.title ?? item.id, account: account.name, fields, notes: ['As variações existentes serão preservadas. O preço é compartilhado pelo anúncio tradicional.'] } })] };
  }

  async prepareCreate(business: BusinessAccount, userId: string, args: any): Promise<MarketplacePlan> {
    await this.canWrite(userId);
    const { account, token, item } = await this.target(business, this.mlb(args.modelo_mlb));
    const title = this.string(args.titulo, 'Título / nome da família', 120);
    if (args.usar_preco_modelo === true && args.preco != null) throw new BadRequestException('Escolha um preço informado ou o preço do modelo, sem combinar os dois.');
    const price = this.price(args.usar_preco_modelo === true ? item.price : args.preco);
    const quantity = this.quantity(args.estoque);
    const sku = this.string(args.sku, 'SKU', 100);
    if (item.currency_id !== 'BRL' || !item.category_id) throw new BadRequestException('Use como modelo um anúncio brasileiro em reais com categoria válida.');
    if (item.shipping?.logistic_type === 'fulfillment') throw new BadRequestException('Escolha um modelo fora do Full para criar anúncios pelo chat.');
    let seller;
    try { seller = await this.client.getSeller(token, account.sellerId); } catch (error) { throw this.providerError(error); }
    if (seller.tags?.includes('warehouse_management')) throw new BadRequestException('A publicação em contas com estoque por depósito deve ser feita pelo fluxo de depósitos do Mercado Livre.');
    const updates = args.atributos != null ? this.attributes(args.atributos) : [];
    if (item.variations?.length && !updates.length) throw new BadRequestException('O modelo possui variações. Informe os atributos completos da cor e tamanho do novo produto.');
    const pictures = args.fotos != null ? this.photos(args.fotos) : item.pictures?.map(p => ({ id: p.id }));
    if (!pictures?.length) throw new BadRequestException('Informe pelo menos uma foto.');
    const body: Record<string, any> = {
      category_id: item.category_id, currency_id: 'BRL', price, available_quantity: quantity,
      buying_mode: 'buy_it_now', listing_type_id: item.listing_type_id, condition: item.condition,
      pictures, attributes: this.mergeAttributes(item.attributes, [...updates, { id: 'SELLER_SKU', value_name: sku }]),
      sale_terms: this.mergeAttributes(item.sale_terms, [])
    };
    const catalogAttributes = new Map((item.attributes ?? []).map(a => [a.id,a]));
    updates.forEach(a => catalogAttributes.set(a.id,a));
    await this.validateCatalogSku(business,sku,[...catalogAttributes.values()]);
    body[seller.tags?.includes('user_product_seller') || item.family_name ? 'family_name' : 'title'] = title;
    const description = args.descricao != null ? this.string(args.descricao, 'Descrição', 10000) : undefined;
    if (description && /<\/?[a-z][^>]*>/i.test(description)) throw new BadRequestException('Use descrição em texto simples.');
    try { await this.client.validateItem(token, body); } catch (error) { throw this.providerError(error); }
    const fields: PreviewField[] = [
      { field: 'Publicação completa', before: 'Novo anúncio', after: JSON.stringify(body, null, 2) }
    ];
    if (description) fields.push({ field: 'Descrição', before: 'Sem descrição', after: description });
    await this.saveLocal(account,item);
    return { kind: 'create', targets: [{ account, mlb: item.id, fingerprint: this.fingerprint(item), before: {}, body, description,
      preview: { mlb: `Novo anúncio · modelo ${item.id}`, title, account: account.name, fields,
        notes: [...(args.usar_preco_modelo === true ? [`Preço herdado do modelo ${item.id}, consultado ao vivo: ${this.money(price)}.`] : []), 'Fotos, categoria, condição, tipo de anúncio e atributos não informados são herdados do modelo. Confira todos os dados.', 'A confirmação publica um novo anúncio e pode gerar tarifas do Mercado Livre.', 'É publicado um produto por proposta. Outras cores e tamanhos podem ser preparados separadamente.'] } }] };
  }

  private auditSnapshot(item: MeliItemResponse): Record<string, unknown> {
    return { mlb: item.id, title: item.title, familyName: item.family_name, familyId: item.family_id, userProductId: item.user_product_id, price: item.price, quantity: item.available_quantity,
      status: item.status, pictures: item.pictures?.map(p => p.id), attributes: item.attributes,
      variations: item.variations?.map(v => ({ id: v.id, quantity: v.available_quantity, combinations: v.attribute_combinations, attributes: v.attributes })) };
  }

  async saveLocal(account: SellerAccount, item: MeliItemResponse) {
    const data = { userProductId: item.user_product_id, title: item.title ?? item.id, status: item.status ?? 'unknown',
      listingTypeId: item.listing_type_id, catalogProductId: item.catalog_product_id, price: item.price ?? 0,
      availableQuantity: item.available_quantity ?? 0, soldQuantity: item.sold_quantity ?? 0, permalink: item.permalink,
      rawData: item as unknown as Prisma.InputJsonValue, lastSyncedAt: new Date() };
    const listing = await this.prisma.marketplaceListing.upsert({ where: { marketplaceAccountId_itemId: { marketplaceAccountId: account.id, itemId: item.id } },
      update: data, create: { ...data, marketplaceAccountId: account.id, itemId: item.id } });
    for (const v of item.variations ?? []) {
      const variantData = { availableQuantity: v.available_quantity ?? 0, soldQuantity: v.sold_quantity ?? 0,
        sku: sellerSku(v),
        attributes: { attribute_combinations: (v.attribute_combinations ?? []) as Prisma.InputJsonValue, attributes: (v.attributes ?? []) as Prisma.InputJsonValue },
        rawData: v as unknown as Prisma.InputJsonValue };
      await this.prisma.marketplaceListingVariant.upsert({ where: { listingId_variationId: { listingId: listing.id, variationId: String(v.id) } },
        update: variantData, create: { ...variantData, listingId: listing.id, variationId: String(v.id) } });
    }
    await pruneListingVariants(this.prisma, listing.id, item.variations);
  }

  private async priceReadbackDelay(ms:number){await new Promise(resolve=>setTimeout(resolve,ms));}
  async verifyPricePlan(plan:MarketplacePlan,business:BusinessAccount){
    for(const target of plan.targets){const source=await this.target(business,target.mlb);if(target.body.price==null)throw new BadRequestException('Esta proposta não é uma alteração de preço.');if(target.standardPrice){const prices=standardPrices(await this.client.getItemPrices(source.token,target.mlb),source.item.currency_id!);if(!this.sameValue(prices,target.standardPrice.prices))return false;}else if(source.item.price!==target.body.price)return false;if(target.removeAutomation&&await this.client.getPriceAutomation(source.token,target.mlb))return false;}
    return plan.targets.length>0;
  }
  private async verifyPriceReadback(token:string,mlb:string,currency:string,expected:StandardPrice[]){
    for(let attempt=0;attempt<5;attempt++){
      const observed=standardPrices(await this.client.getItemPrices(token,mlb),currency);
      if(this.sameValue(observed,expected))return true;
      if(attempt<4)await this.priceReadbackDelay(1000*2**attempt);
    }
    return false;
  }
  private verified(item: MeliItemResponse, body: Record<string, any>, before: Record<string, unknown> = {}) {
    if (body.price != null && Math.round(Number(item.price) * 100) !== Math.round(body.price * 100)) return false;
    if (body.available_quantity != null && item.available_quantity !== body.available_quantity) return false;
    if (body.status != null && item.status !== body.status) return false;
    if (body.title != null && item.title !== body.title) return false;
    if (body.family_name != null && item.family_name !== body.family_name) return false;
    if (body.pictures) {
      if (item.pictures?.length !== body.pictures.length) return false;
      if (body.pictures.some((p: any, index: number) => p.id && item.pictures?.[index]?.id !== p.id)) return false;
      // ML replaces source URLs with picture IDs. A source slot unchanged from the
      // preview cannot prove the requested replacement was applied.
      const oldPictures = (before.pictures ?? []) as string[];
      if (body.pictures.some((p: any, index: number) => p.source && (!item.pictures?.[index]?.id || item.pictures[index].id === oldPictures[index]))) return false;
    }
    const matchesAttributes = (actual: any[] = [], expected: any[] = []) => expected.every(a => {
      if(a.id==='SELLER_SKU'&&a.value_name===null&&a.value_id==null&&!a.values?.length)return !actual.some(v=>v.id===a.id&&(v.value_name||v.value_id||v.values?.some((value:any)=>value.name||value.id)));
      return actual.some(v => {
      if(v.id!==a.id)return false;
      if(!a.values?.length&&a.value_id==null&&a.value_name!=null&&v.value_name===a.value_name)return true;
      const values=a.values?.length?a.values:[{id:a.value_id,name:a.value_name}];
      const observed=v.values?.length?v.values:[{id:v.value_id,name:v.value_name}];
      return values.every((value:any)=>observed.some((found:any)=>value.id!=null?String(found.id)===String(value.id):value.name!=null&&found.name===value.name));
      });
    });
    if (body.attributes && !matchesAttributes(item.attributes, body.attributes)) return false;
    for (const variation of body.variations ?? []) {
      const actual = item.variations?.find(v => variation.id != null ? String(v.id) === String(variation.id) : (v.attributes as any[])?.some(a => a.id === 'SELLER_SKU' && a.value_name === variation.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name));
      if (!actual || (variation.available_quantity != null && actual.available_quantity !== variation.available_quantity) || (variation.price != null && actual.price !== variation.price)) return false;
      if (!matchesAttributes(actual.attribute_combinations as any[], variation.attribute_combinations)) return false;
      if (!matchesAttributes(actual.attributes as any[], variation.attributes)) return false;
      if (variation.picture_ids && JSON.stringify(actual.picture_ids) !== JSON.stringify(variation.picture_ids)) return false;
    }
    return true;
  }

  private async sendVariationBatches(context:{account:SellerAccount;token:string;target:Target;body:Record<string,any>;current:MeliItemResponse;business:BusinessAccount;auditId:string;progress:VariationBatchProgress;onSend:()=>void;onAcknowledged:()=>void}) {
    const {account,token,target,body,business,auditId,progress}=context;
    const additions=body.variations.filter((row:any)=>row.id==null);
    const existing=new Map<string,any>(body.variations.filter((row:any)=>row.id!=null).map((row:any)=>[String(row.id),row]));
    const approvedPrice=typeof target.before.price==='number'?target.before.price:context.current.price;
    if(context.current.price!==approvedPrice)throw new ConflictException('O preco compartilhado mudou desde a previa. Nenhum lote foi enviado.');
    let previous=context.current;
    for(let offset=0;offset<additions.length;offset+=VARIATION_BATCH_SIZE){
      const chunk=additions.slice(offset,offset+VARIATION_BATCH_SIZE);
      const batchBody={...body,...(offset>0&&body.pictures?{pictures:previous.pictures?.map(picture=>({id:picture.id}))}:{}),variations:[...(previous.variations??[]).map(row=>existing.get(String(row.id))??{id:row.id}),...chunk]};
      const guarded=this.guardTarget(previous,{...target,body:batchBody});
      const current=await this.readItem(token,target.mlb);this.owner(current,account);
      this.assertCompatible(current,guarded,'update');
      if(current.price!==approvedPrice)throw new ConflictException('O preco compartilhado mudou. Os proximos lotes nao foram enviados.');
      for(const addition of chunk){
        const sku=sellerSku(addition);
        if(!sku||(current.variations??[]).some(row=>sellerSku(row)===sku))throw new ConflictException('Um SKU do proximo lote ja existe. Consulte o resultado antes de preparar outra inclusao.');
        if(target.refreshBlingStockForAdditions){
          if(!this.bling)throw new BadRequestException('Consulta Bling indisponivel. O proximo lote nao foi enviado.');
          const stock=await this.bling.liveStockForSku(business.id,sku);addition.available_quantity=target.additionWarehouse?0:stock.publishable;
        }
      }
      const mutation=this.rebaseBody(current,{...target,body:batchBody});
      await this.restrictions(current,account,token,mutation);
      await this.prisma.auditLog.update({where:{id:auditId},data:{after:{status:'SENDING_BATCH',accountId:account.id,requested:body,variationBatches:progress,sendingSkus:chunk.map((row:any)=>sellerSku(row))} as unknown as Prisma.InputJsonValue}});
      context.onSend();await this.client.updateItem(token,target.mlb,mutation);context.onAcknowledged();
      const fresh=await this.readItem(token,target.mlb);this.owner(fresh,account);
      if(fresh.price!==approvedPrice)throw new ConflictException('O preco compartilhado mudou durante o envio. Confira o lote antes de continuar.');
      if(!this.verified(fresh,mutation,this.auditSnapshot(current))||chunk.some((row:any)=>fresh.variations?.filter(found=>sellerSku(found)===sellerSku(row)).length!==1))throw new BadRequestException('O retorno do lote ainda nao foi confirmado. Os proximos lotes nao foram enviados. Confira o anuncio antes de repetir.');
      progress.completed++;progress.confirmedSkus.push(...chunk.map((row:any)=>sellerSku(row)!));
      await this.saveLocal(account,fresh);
      await this.prisma.auditLog.update({where:{id:auditId},data:{after:{status:'BATCH_VERIFIED',accountId:account.id,requested:body,variationBatches:progress,observed:this.auditSnapshot(fresh)} as unknown as Prisma.InputJsonValue}});
      previous=fresh;
    }
    return previous;
  }

  private async refreshForExecution(target: Target, plan: MarketplacePlan, business: BusinessAccount) {
    const account = await this.prisma.marketplaceAccount.findFirst({ where: { id: target.account.id, marketplace: 'MERCADO_LIVRE', businessKey: business.businessKey, active: true }, select: { id: true, name: true, sellerId: true } });
    if (!account || account.sellerId !== target.account.sellerId) throw new ForbiddenException('A conta da proposta não está mais disponível para este vendedor.');
    const token = await this.token(account);
    const current = await this.readItem(token,target.mlb);
    if(plan.kind==='update'&&target.body.price!=null&&!target.standardPrice){
      const before=standardPrices(await this.client.getItemPrices(token,target.mlb),current.currency_id!);
      target.standardPrice={before,prices:proposedPrices(before,target.body.price)};
    }
    if(target.standardPrice){
      const observed=standardPrices(await this.client.getItemPrices(token,target.mlb),current.currency_id!);
      if(Object.keys(withoutPrice(target.body)).length===0){
        target.standardPrice={before:observed,prices:proposedPrices(observed,target.body.price)};
      }else if(!this.sameValue(observed,target.standardPrice.before)&&!this.sameValue(observed,target.standardPrice.prices))throw new ConflictException('Os preços ou canais mudaram desde a prévia. Atualize a prévia antes de confirmar.');
    }
    this.owner(current,account);
    await this.saveLocal(account,current);
    this.assertCompatible(current,target,plan.kind);
    const body = plan.kind === 'update' ? this.rebaseBody(current,target) : target.body;
    if(target.refreshBlingStockForAdditions && (body.variations??[]).filter((row:any)=>row.id==null).length<=VARIATION_BATCH_SIZE){
      if(!this.bling)throw new BadRequestException('A consulta de estoque Bling está indisponível. Nenhuma variação será enviada.');
      for(const variation of body.variations??[]){if(variation.id!=null)continue;const sku=sellerSku(variation);if(!sku)throw new BadRequestException('Uma nova variação não possui SKU Bling.');const stock=await this.bling.liveStockForSku(business.id,sku);variation.available_quantity=target.additionWarehouse?0:stock.publishable;}
    }
    if (plan.kind === 'update') {
      if (!this.alreadyApplied(current,target,plan)||target.removeAutomation) await this.restrictions(current,account,token,body,target.removeAutomation);
      const quantity = current.variations?.length ? current.variations.reduce((sum,v) => sum + (body.variations?.find((planned: any) => String(planned.id) === String(v.id))?.available_quantity ?? v.available_quantity ?? 0),0)
        : body.available_quantity ?? current.available_quantity ?? 0;
      if (body.status === 'active' && quantity === 0) throw new BadRequestException('Não é possível reativar um anúncio sem estoque.');
    }
    let description: string | null | undefined;
    if (target.descriptionBefore !== undefined) {
      description = (await this.client.getDescription(token,target.mlb))?.plain_text ?? null;
      if (description !== target.descriptionBefore && description !== target.description) throw new ConflictException('A descrição mudou desde a prévia. Prepare uma nova proposta.');
    }
    if (plan.kind === 'create') await this.client.validateItem(token,body);
    return {account,token,current,body,description};
  }

  private alreadyApplied(item: MeliItemResponse, target: Target, plan: MarketplacePlan) {
    const observed = this.mutationState(item,target);
    return plan.kind === 'update' && !!target.desired && !target.body.variations?.some((v: any) => v.id == null)
      && Object.entries(target.desired).every(([field,value]) => this.sameValue(observed[field],value));
  }

  private outcome(results: Array<{mlb:string;success:boolean;message:string;status:string}>) {
    const success = results.every(result => result.success);
    const status = success ? 'SUCCESS' : results.some(r => r.success) ? 'PARTIAL' : results.some(r => r.status === 'UNVERIFIED') ? 'UNVERIFIED' : 'FAILED';
    return {success,status,results,message:results.map(r => `${r.mlb}: ${r.message}`).join('\n'),destination:'/anuncios'};
  }

  async execute(plan: MarketplacePlan, business: BusinessAccount, userId: string) {
    await this.canWrite(userId);
    if (plan.kind === 'family_variants') return this.familyVariants.execute(plan,business,userId);
    if (plan.family) {
      const group = await this.resolveFamily(business, plan.family.reference);
      if (JSON.stringify(group.children.map((c: any) => c.itemId).sort()) !== JSON.stringify(plan.family.members)) {
        throw new ConflictException('As variações do anúncio pai mudaram desde a prévia. Prepare uma nova proposta.');
      }
    }
    const keys = [...new Set(plan.targets.flatMap(target => [`${target.account.id}:${target.mlb}`, ...(target.userProductId ? [`${target.account.id}:product:${target.userProductId}`] : []),...(target.removeAutomation?[`${target.account.id}:${target.removeAutomation.mlb}`]:[])]))];
    if (keys.some(key => this.locks.has(key))) return this.outcome(plan.targets.map(target => ({mlb:target.mlb,success:false,status:'FAILED',message:'Já existe uma alteração em andamento para este anúncio ou produto.'})));
    keys.forEach(key => this.locks.add(key));
    const results: Array<{ mlb: string; success: boolean; message: string; status: string }> = [];
    try {
      // Validate the complete batch before sending the first marketplace write.
      for (const target of plan.targets) {
        try { await this.refreshForExecution(target,plan,business); }
        catch (error) {
          return this.outcome(plan.targets.map(row => ({mlb:row.mlb,success:false,status:'FAILED',message:row === target
            ? this.providerError(error).message : 'Nenhuma alteração enviada: um anúncio do lote precisa de revisão ou não está disponível.'})));
        }
      }
      for (const target of plan.targets) {
      let auditId: string | undefined;
      let sent = false;
      let acknowledgedWrite=false;
      let automationRemoved=false;
      let writtenMlb = target.mlb;
      let body = target.body;
      const additions=plan.kind==='update'?(target.body.variations??[]).filter((row:any)=>row.id==null):[];
      const variationBatches:VariationBatchProgress|undefined=additions.length>VARIATION_BATCH_SIZE?{size:VARIATION_BATCH_SIZE,total:Math.ceil(additions.length/VARIATION_BATCH_SIZE),completed:0,confirmedSkus:[]}:undefined;
      try {
        const refreshed = await this.refreshForExecution(target,plan,business);
        const {account,token,current} = refreshed;
        body = refreshed.body;
        const bodyAlreadyApplied = this.alreadyApplied(current,target,plan);
        const descriptionAlreadyApplied = target.description === undefined || refreshed.description === target.description;
        const unchanged = bodyAlreadyApplied && descriptionAlreadyApplied;
        const audit = await this.prisma.auditLog.create({ data: { userId, action: plan.kind === 'create' ? 'CHAT_ML_CREATE_DETAIL' : 'CHAT_ML_UPDATE_DETAIL', entityType: 'MarketplaceListing', entityId: target.mlb,
          before: (plan.kind === 'update' ? this.auditSnapshot(current) : target.before) as Prisma.InputJsonValue, after: { status: 'PENDING', accountId: account.id, requested: body, description: target.description ?? null,automationRemoval:target.removeAutomation??null } as Prisma.InputJsonValue } });
        auditId = audit.id;
        let item = current;
        if(target.removeAutomation){
          const automation=await this.client.getPriceAutomation(token,target.mlb,true);
          if(automation&&((automation.item_id??current.id)!==target.removeAutomation.mlb||(automation.item_rule?.rule_id??'')!==target.removeAutomation.ruleId||(automation.min_price??null)!==target.removeAutomation.minPrice||(automation.max_price??null)!==target.removeAutomation.maxPrice))throw new ConflictException('A regra de automatização mudou. Nenhuma desativação foi enviada. Prepare outra prévia.');
          if(automation){sent=true;await this.client.removePriceAutomation(token,target.removeAutomation.mlb);acknowledgedWrite=true;}
          let remaining=await this.client.getPriceAutomation(token,target.mlb,true);
          for(let attempt=0;remaining&&attempt<2;attempt++){await new Promise(resolve=>setTimeout(resolve,300));remaining=await this.client.getPriceAutomation(token,target.mlb,true);}
          if(remaining)throw new BadRequestException('A desativação foi enviada, mas ainda não foi confirmada. O preço não foi alterado. Consulte a automatização antes de repetir.');
          automationRemoved=true;
        }
        if (plan.kind === 'create') { sent = true; item = await this.client.createItem(token, body); writtenMlb = item.id;acknowledgedWrite=true; }
        else {
          const mutation=body;
          if(Object.keys(mutation).length&&!bodyAlreadyApplied){
            if(variationBatches)item=await this.sendVariationBatches({account,token,target,body:mutation,current,business,auditId:audit.id,progress:variationBatches,onSend:()=>{sent=true;},onAcknowledged:()=>{acknowledgedWrite=true;}});
            else {sent=true;item=await this.client.updateItem(token,target.mlb,mutation);acknowledgedWrite=true;}
          }
        }
        if (target.description !== undefined && !descriptionAlreadyApplied) { sent = true; await this.client.setDescription(token, item.id, target.description, refreshed.description != null);acknowledgedWrite=true; }
        if(target.additionWarehouse){
          if(!this.bling)throw new BadRequestException('Consulta Bling indisponível para vincular o estoque ao depósito.');
          const created=await this.readItem(token,item.id);this.owner(created,account);
          for(const addition of body.variations??[]){
            if(addition.id!=null)continue;
            const sku=sellerSku(addition)!;
            const variant=created.variations?.find(row=>sellerSku(row)===sku);
            const upId=(variant as any)?.user_product_id;
            if(!upId)throw new BadRequestException(`A variação ${sku} foi enviada, mas seu vínculo ao depósito ainda não foi confirmado. Consulte antes de repetir.`);
            const live=await this.bling.liveStockForSku(business.id,sku);
            const stock=await this.client.getProductStock(token,upId);
            if(stock&&(stock.data.id!==upId||String(stock.data.user_id)!==account.sellerId))throw new ForbiddenException('O estoque não pertence à variante deste vendedor.');
            const warehouse=target.additionWarehouse;
            const locations=stock?.data.locations.filter((location:any)=>location.type==='seller_warehouse').map((location:any)=>({store_id:String(location.store_id),network_node_id:String(location.network_node_id),quantity:location.quantity}))??[];
            const location=locations.find((location:any)=>location.store_id===warehouse.store_id&&location.network_node_id===warehouse.network_node_id);
            if(location?.quantity!==live.publishable){
              if(location)location.quantity=live.publishable;else locations.push({...warehouse,quantity:live.publishable});
              if(stock)await this.client.updateWarehouseStock(token,upId,locations,stock.version);else await this.client.initializeWarehouseStock(token,upId,{...warehouse,quantity:live.publishable});
            }
            const verifiedStock=await this.client.getProductStock(token,upId);
            if(!verifiedStock?.data.locations.some((location:any)=>location.type==='seller_warehouse'&&String(location.store_id)===warehouse.store_id&&String(location.network_node_id)===warehouse.network_node_id&&location.quantity===live.publishable))throw new BadRequestException(`A variação ${sku} está no anúncio, mas o estoque do depósito ainda não foi confirmado. Consulte antes de repetir.`);
            addition.available_quantity=live.publishable;
          }
        }
        const fresh = await this.readItem(token, item.id);
        this.owner(fresh, account);
        const descriptionOk = target.description === undefined || (await this.client.getDescription(token, item.id))?.plain_text === target.description;
        const verifiedPrices=!target.standardPrice||await this.verifyPriceReadback(token,item.id,fresh.currency_id!,target.standardPrice.prices);
        const success = verifiedPrices&&this.verified(fresh,target.standardPrice?withoutPrice(body):body,target.before) && descriptionOk;
        const registrationBody=target.additionWarehouse?{...body,variations:body.variations?.map((variation:any)=>{if(variation.id!=null)return variation;const {available_quantity,...registered}=variation;return registered;})}:body;
        const registeredWithStockPending=!success&&!!target.additionWarehouse&&descriptionOk&&this.verified(fresh,registrationBody,target.before);
        await this.prisma.auditLog.update({ where: { id: auditId }, data: { entityId: fresh.id, after: { accountId: account.id, status: success ? 'VERIFIED' : 'UNVERIFIED', requested: body, unchanged,
          description: target.description ?? null,automationRemoved, variationBatches, observed: this.auditSnapshot(fresh) } as Prisma.InputJsonValue } });
        await this.saveLocal(account, fresh);
        results.push({ mlb: fresh.id, success, status: success ? 'SUCCESS' : 'UNVERIFIED', message: (success ? target.removeAutomation?'Automatização desativada e preço fixo aplicado e verificado no Mercado Livre.':unchanged ? 'Os valores aprovados já estavam aplicados e foram verificados no Mercado Livre.' : 'Alteração aplicada e verificada no Mercado Livre.' : registeredWithStockPending ? 'Variações publicadas e conferidas no anúncio. O estoque foi confirmado no depósito, mas o Mercado Livre ainda não refletiu todo o saldo no anúncio. Não é necessário publicar novamente.' : 'A conferência encontrou valores pendentes no Mercado Livre. Consulte o resultado da ação; não repita a publicação.') + (variationBatches ? ` Lotes confirmados: ${variationBatches.completed}/${variationBatches.total}.` : '') });
      } catch (error) {
        if(!acknowledgedWrite&&[400,401,403,404,409,412,422,429].includes((error as any)?.response?.status))sent=false;
        const message = `${automationRemoved?'A automatização foi desativada, mas o preço ou as demais alterações não foram confirmados. ':target.removeAutomation&&acknowledgedWrite?'A desativação foi enviada, mas ainda não foi confirmada. O preço não foi alterado. ':''}${this.providerError(error,'write').message}` + (variationBatches ? ` Lotes confirmados: ${variationBatches.completed}/${variationBatches.total}; ${variationBatches.confirmedSkus.length}/${additions.length} selecionadas confirmadas.` : '');
        if (auditId) {
          try { await this.prisma.auditLog.update({ where: { id: auditId }, data: { entityId: writtenMlb, after: { accountId: target.account.id, status: sent ? 'UNVERIFIED' : 'FAILED', requested: body,
            description: target.description ?? null,automationRemoved, variationBatches, message } as Prisma.InputJsonValue } }); } catch { /* The durable PENDING record remains available for reconciliation. */ }
        }
        results.push({ mlb: writtenMlb, success: false, status: sent ? 'UNVERIFIED' : 'FAILED', message: `${sent ? 'A operação pode ter sido aplicada parcialmente. Consulte o anúncio antes de repetir. ' : ''}${message}` });
      }
      }
      return this.outcome(results);
    } finally {
      keys.forEach(key => this.locks.delete(key));
    }
  }
}



