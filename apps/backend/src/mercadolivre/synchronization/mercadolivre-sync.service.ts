import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { marketplaceSyncEvents } from '../sync-events';
import { Prisma, SyncSource, SyncStatus, SyncType } from '@prisma/client';
import { AuditEngineService } from '../../audit/audit-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MercadoLivreAuthService } from '../auth/mercadolivre-auth.service';
import { MercadoLivreClient, MeliItemResponse, MeliVariationResponse } from '../mercadolivre.client';
import { ListingMatcherService } from './listing-matcher.service';
import { sellerSku } from './seller-sku';
import { pruneListingVariants } from './prune-listing-variants';
import { creationDay } from './created-day';

@Injectable()
export class MercadoLivreSyncService {
  private readonly logger = new Logger(MercadoLivreSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: MercadoLivreAuthService,
    private readonly client: MercadoLivreClient,
    private readonly matcher: ListingMatcherService,
    private readonly audit: AuditEngineService
  ) {}

  enqueue(accountId: string, type: SyncType = SyncType.MANUAL_SYNC) {
    return this.syncAccount(accountId, type);
  }

  async startBackground(accountId: string, type:SyncType=SyncType.MANUAL_SYNC) {
    const current = await this.prisma.syncExecution.findFirst({ where: { marketplaceAccountId: accountId, source: SyncSource.MERCADO_LIVRE, status: { in: [SyncStatus.RUNNING, SyncStatus.PENDING] } } });
    if (current) throw new ConflictException('Já existe uma sincronização do Mercado Livre em andamento.');
    const execution = await this.prisma.syncExecution.create({ data: { type, source: SyncSource.MERCADO_LIVRE, marketplaceAccountId: accountId, status: SyncStatus.RUNNING, startedAt: new Date() } });
    void this.syncAccount(accountId, type, undefined, execution.id).catch(async () => {
      // syncAccount records the original failure. Never replace it after it has
      // finished; this fallback covers only failures before its own catch.
      await this.prisma.syncExecution.updateMany({ where: { id: execution.id,status:{in:[SyncStatus.RUNNING,SyncStatus.PENDING]} }, data: { status: SyncStatus.FAILED, finishedAt: new Date(), errors: 1, errorDetails: { message: 'Não foi possível concluir a sincronização.' } } });
    });
    return execution;
  }

  async syncToday(accountId:string){
    const current=await this.prisma.syncExecution.findFirst({where:{marketplaceAccountId:accountId,source:SyncSource.MERCADO_LIVRE,status:{in:[SyncStatus.RUNNING,SyncStatus.PENDING]}}});
    if(current)throw new ConflictException('Já existe uma sincronização do Mercado Livre em andamento. Aguarde a conclusão.');
    return this.syncAccount(accountId,SyncType.MANUAL_SYNC,undefined,undefined,true);
  }
  async syncAccount(accountId: string, type: SyncType = SyncType.MANUAL_SYNC, maxItems?: number, executionId?: string,onlyToday=false) {
    const day=onlyToday?creationDay(new Date()):null;
    const scope=day?{scope:'today',day,timeZone:'America/Sao_Paulo'}:{};
    const execution = executionId
      ? await this.prisma.syncExecution.findUniqueOrThrow({ where: { id: executionId } })
      : await this.prisma.syncExecution.create({ data: { type, source: SyncSource.MERCADO_LIVRE, marketplaceAccountId: accountId, status: SyncStatus.RUNNING, startedAt: new Date(),...(day?{errorDetails:scope}:{}) } });
    const errors: Array<{ itemId?: string; message: string }> = [];
    let processed = 0;
    let stage='account';let currentIds:string[]=[];
    try {
      const account = await this.prisma.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId } });
      const token = await this.auth.getValidAccessToken(accountId);
      // Creation dates are immutable. Read only IDs and their cached creation
      // date, and fetch bodies for unknown items, missing dates and today's items.
      const known=new Map<string,string|null>();
      if(day){const cached=await this.prisma.$queryRaw<Array<{itemId:string;createdAt:string|null}>>(Prisma.sql`SELECT "itemId", "rawData"->>'date_created' AS "createdAt" FROM "MarketplaceListing" WHERE "marketplaceAccountId"=${accountId}`);for(const row of cached)known.set(row.itemId,creationDay(row.createdAt));}
      let offset = 0;
      const limit = 50;
      let total = 1;
      let scrollId: string | undefined;
      const seenIds=new Set<string>();
      while (offset < total && (maxItems === undefined || offset < maxItems)) {
        const pageLimit = maxItems === undefined ? limit : Math.min(limit, maxItems - offset);
        stage='search';currentIds=[];
        const page = await this.client.searchSellerItems(token, account.sellerId, maxItems === undefined
          ? { search_type: 'scan', limit: pageLimit, ...(scrollId ? { scroll_id: scrollId } : {}) }
          : { offset, limit: pageLimit });
        total = page.paging.total;
        const totalItems = maxItems === undefined ? total : Math.min(total, maxItems);
        const itemIds = page.results.slice(0, pageLimit);
        for(const id of itemIds)seenIds.add(id);
        if (!itemIds.length) {
          if (offset < totalItems) throw new Error('A busca encerrou antes de retornar todos os anúncios. Tente sincronizar novamente.');
          break;
        }
        scrollId = page.scroll_id;
        const candidates=day?itemIds.filter(id=>!known.get(id)||known.get(id)===day):itemIds;
        stage='items';currentIds=candidates;
        const items = candidates.length?await this.client.getItems(token, candidates):[];
        if(items.length!==candidates.length)throw new Error('A consulta não retornou todos os anúncios do lote.');
        stage='persist';
        for (const [index,item] of items.entries()) {
          if (item.code !== 200) {
            errors.push({ itemId: item.body?.id??candidates[index], message: `Mercado Livre returned ${item.code}` });
            continue;
          }
          if(day){const created=creationDay(item.body.date_created);if(!created){errors.push({itemId:item.body.id,message:'O Mercado Livre não retornou uma data de criação válida; anúncio não importado pela sincronização de hoje.'});continue;}if(created!==day)continue;}
          await this.upsertItem(accountId, item.body);
          processed++;
        }
        offset += itemIds.length;
        await this.prisma.syncExecution.update({ where: { id: execution.id }, data: { itemsProcessed: processed, errors: errors.length, errorDetails: {...scope,progress: { total: day?null:totalItems, attempted: offset, percent: totalItems ? Math.min(99, Math.floor(offset / totalItems * 100)) : 0 } } } });
        if (maxItems === undefined && offset < total && !scrollId) throw new Error('O Mercado Livre não retornou o cursor para continuar a sincronização.');
      }
      if(!day&&maxItems===undefined){
        stage='reconcile';currentIds=[];
        const reconciliation=await this.reconcileUnseen(accountId,account.sellerId,token,seenIds);
        processed+=reconciliation.processed;errors.push(...reconciliation.errors);
      }
      stage='matching';currentIds=[];const matching = await this.matcher.run();
      stage='audit';await this.audit.run();
      await this.prisma.syncExecution.update({ where: { id: execution.id }, data: { status: errors.length ? SyncStatus.PARTIAL : SyncStatus.SUCCESS, finishedAt: new Date(), itemsProcessed: processed, errors: errors.length, errorDetails: { ...scope,errors, matching } } });
      marketplaceSyncEvents.emit('synced',accountId);
      this.logger.log(`sync finished accountId=${accountId} processed=${processed} errors=${errors.length}`);
      return { processed, errors,...scope };
    } catch (error) {
      const response=(error as any)?.response;
      const providerError=typeof response?.data?.error==='string'?response.data.error.slice(0,100):undefined;
      const message = typeof response?.data?.message==='string'?response.data.message.slice(0,500):error instanceof Error ? error.message.slice(0,500) : 'unknown error';
      await this.prisma.syncExecution.update({ where: { id: execution.id }, data: { status: SyncStatus.FAILED, finishedAt: new Date(), itemsProcessed: processed, errors: errors.length + 1, errorDetails: [...errors, { message,stage,httpStatus:response?.status,providerError,...(currentIds.length?{itemIds:currentIds}:{}) }] as Prisma.InputJsonValue } });
      throw error;
    }
  }

  private async reconcileUnseen(accountId:string,sellerId:string,token:string,seenIds:Set<string>){
    const cached=await this.prisma.marketplaceListing.findMany({where:{marketplaceAccountId:accountId,status:{not:'closed'},itemId:{notIn:[...seenIds]}},select:{itemId:true}});
    let processed=0;const errors:Array<{itemId:string;message:string}>=[];
    for(let offset=0;offset<cached.length;offset+=20){
      const ids=cached.slice(offset,offset+20).map(row=>row.itemId);
      const responses=await this.client.getItems(token,ids);
      if(responses.length!==ids.length)throw new Error('A conferência dos anúncios antigos retornou um lote incompleto.');
      for(const [index,response]of responses.entries()){
        const itemId=ids[index];
        if(response.code!==200){errors.push({itemId,message:`Não foi possível conferir o status atual: Mercado Livre HTTP ${response.code}.`});continue;}
        if(response.body.id!==itemId||String(response.body.seller_id)!==String(sellerId)){errors.push({itemId,message:'O anúncio retornado não corresponde ao vendedor desta conta.'});continue;}
        await this.upsertItem(accountId,response.body);processed++;
      }
    }
    return {processed,errors};
  }

  private async upsertItem(accountId: string, item: MeliItemResponse) {
    const listing = await this.prisma.marketplaceListing.upsert({
      where: { marketplaceAccountId_itemId: { marketplaceAccountId: accountId, itemId: item.id } },
      update: this.toListingData(item),
      create: { ...this.toListingData(item), marketplaceAccountId: accountId, itemId: item.id }
    });
    for (const variation of item.variations ?? []) {
      await this.prisma.marketplaceListingVariant.upsert({
        where: { listingId_variationId: { listingId: listing.id, variationId: String(variation.id) } },
        update: this.toVariantData(variation),
        create: { ...this.toVariantData(variation), listingId: listing.id, variationId: String(variation.id) }
      });
    }
    await pruneListingVariants(this.prisma, listing.id, item.variations);
  }

  private toListingData(item: MeliItemResponse) {
    return {
      userProductId: item.user_product_id,
      title: item.title ?? item.id,
      status: item.status ?? 'unknown',
      listingTypeId: item.listing_type_id,
      catalogProductId: item.catalog_product_id,
      price: item.price ?? 0,
      availableQuantity: item.available_quantity ?? 0,
      soldQuantity: item.sold_quantity ?? 0,
      permalink: item.permalink,
      rawData: item as unknown as Prisma.InputJsonValue,
      lastSyncedAt: new Date()
    };
  }

  private toVariantData(variation: MeliVariationResponse) {
    return {
      userProductId: variation.user_product_id,
      sku: sellerSku(variation),
      availableQuantity: variation.available_quantity ?? 0,
      soldQuantity: variation.sold_quantity ?? 0,
      attributes: {
        attribute_combinations: (variation.attribute_combinations ?? []) as Prisma.InputJsonValue,
        attributes: (variation.attributes ?? []) as Prisma.InputJsonValue
      },
      rawData: variation as unknown as Prisma.InputJsonValue
    };
  }
}
