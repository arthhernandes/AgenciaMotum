import { Injectable, Optional } from '@nestjs/common';
import { ListingFiscalStateService } from './listing-fiscal-state.service';
import { Prisma } from '@prisma/client';
import { PaginationQuery, paginate } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { groupListings } from './group-listings';
import { applySharedStock } from '../bling/synchronization/shared-stock';
import { listingSkuState } from './sku-catalog-match';
import { catalogSearch } from '../common/catalog-search';
import { ListingsQuery } from './dto';
import { ListingSalesService } from './listing-sales.service';
import { sortListingGroups } from './sort-listing-groups';
import { ListingPricesService } from './listing-prices.service';
import { PUBLICATION_BLOCK_CATEGORY, listingWriteBlock, FINALIZED_MESSAGE } from './listing-write-block';

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService,@Optional() private readonly fiscal?:ListingFiscalStateService,@Optional() private readonly prices?:ListingPricesService,@Optional() private readonly sales?:ListingSalesService) {}

  async findGrouped(query: ListingsQuery) {
    const all = await this.findAll({ page: 1, limit: 50, marketplaceAccountId: query.marketplaceAccountId }, true);
    const accounts = await this.prisma.marketplaceAccount.findMany({ where: { marketplace: 'BLING' }, select: { id: true, businessKey: true } });
    const selectedBling=accounts.find(account=>account.id===query.marketplaceAccountId);
    const scopeIds = selectedBling?[selectedBling.id]:accounts.filter(account => all.data.some(listing => listing.marketplaceAccount.businessKey === account.businessKey)).map(account => account.id);
    const [products, variants] = await Promise.all([
      this.prisma.product.findMany({ where: { blingAccountId: { in: scopeIds } }, select: { blingAccountId: true, sku: true } }),
      this.prisma.productVariant.findMany({ where: { blingAccountId: { in: scopeIds } }, select: { blingAccountId: true, sku: true, product: { select: { sku: true } } } })
    ]);
    const businessByAccount = new Map(accounts.map(account => [account.id, account.businessKey]));
    const skusByBusiness = new Map<string, Set<string>>();
    for (const item of [...products, ...variants]) {
      if (!item.blingAccountId) continue;
      const business = businessByAccount.get(item.blingAccountId)!;
      if (!skusByBusiness.has(business)) skusByBusiness.set(business, new Set());
      skusByBusiness.get(business)!.add(item.sku);
    }
    const parentsByBusiness=new Map<string,Map<string,Set<string>>>();
    const addParent=(accountId:string|null,sku:string,parent:string)=>{const business=accountId?businessByAccount.get(accountId):undefined;if(!business)return;if(!parentsByBusiness.has(business))parentsByBusiness.set(business,new Map());const map=parentsByBusiness.get(business)!;if(!map.has(sku))map.set(sku,new Set());map.get(sku)!.add(parent);};
    for(const product of products)addParent(product.blingAccountId,product.sku,product.sku);
    for(const variant of variants)addParent(variant.blingAccountId,variant.sku,variant.product.sku);
    for (const listing of all.data){
      Object.assign(listing, listingSkuState(listing, skusByBusiness.get(listing.marketplaceAccount.businessKey) ?? new Set()));
      const map=parentsByBusiness.get(listing.marketplaceAccount.businessKey),attributes=(listing.rawData as any)?.attributes??[];
      const skus=[...listing.variants.map((variant:any)=>variant.sku),attributes.find((attribute:any)=>attribute.id==='SELLER_SKU')?.value_name,(listing.rawData as any)?.seller_custom_field];
      Object.assign(listing,{catalogParentSkus:[...new Set(skus.flatMap(sku=>[...(map?.get(sku)??[])]))].sort()});
    }
    const blocks=await this.prisma.integrationSnapshot.findMany({where:{category:PUBLICATION_BLOCK_CATEGORY,marketplaceAccountId:{in:[...new Set<string>(all.data.map(row=>row.marketplaceAccountId))]}},select:{marketplaceAccountId:true,key:true,payload:true}});
    for(const listing of all.data){const raw=listing.rawData as any;const blocked=listingWriteBlock(listing)||blocks.some(block=>block.marketplaceAccountId===listing.marketplaceAccountId&&(block.key===listing.userProductId||String((block.payload as any)?.familyId)===String(raw?.family_id)));Object.assign(listing,{interactionBlocked:!!blocked,interactionBlockReason:blocked?FINALIZED_MESSAGE:undefined});}
    let groups = groupListings(all.data, query);
    const promotionCheck=query.promotion&&this.prices?await this.prices.annotate(groups):undefined;
    if(query.promotion)groups=groups.filter(group=>(group as any).promotionStatus===query.promotion);
    const fiscalCheck=query.fiscalStatus&&this.fiscal?await this.fiscal.annotate(groups,query.fiscalStatus==='cost_above_bling',scopeIds):undefined;
    if(query.fiscalStatus)groups=groups.filter(group=>query.fiscalStatus==='cost_above_bling'?(group as any).costAboveBlingCount>0:(group as any).fiscalStatus===query.fiscalStatus);
    if(query.sortBy==='sold'&&this.sales){
      const ids=[...new Set(groups.flatMap(group=>group.children.map((child:any)=>child.itemId)))];
      const response=await this.sales.ranking(query.marketplaceAccountId!,ids,query.dateFrom!,query.dateTo!,query.progressId);
      const metrics=new Map<string,any>(response.items.map(item=>[item.itemId,item]));
      for(const group of groups){
        Object.assign(group,{periodSoldQuantity:group.children.reduce((sum:number,child:any)=>sum+metrics.get(child.itemId).soldQuantity,0),salesLoading:false,periodSalesFrom:query.dateFrom,periodSalesTo:query.dateTo});
        for(const variant of group.variants){const metric=metrics.get(variant.itemId);variant.periodSoldQuantity=String(variant.variationId)===variant.itemId?metric.soldQuantity:metric.variations.find((row:any)=>String(row.variationId)===String(variant.variationId))?.soldQuantity??0;}
      }
      groups.sort((a:any,b:any)=>((a.periodSoldQuantity-b.periodSoldQuantity)*(query.sortDirection==='asc'?1:-1))||String(a.id).localeCompare(String(b.id)));
    }else groups=sortListingGroups(groups,query.sortBy,query.sortDirection);
    return {...paginate(groups.slice((query.page - 1) * query.limit, query.page * query.limit), query.page, query.limit, groups.length),...(fiscalCheck?{fiscalCheck}:{}),...(promotionCheck?{promotionCheck}:{})};
  }

  async findAll(query: PaginationQuery & { search?: string; status?: string; marketplaceAccountId?: string; linked?: string }, allRows = false) {
    const where: Prisma.MarketplaceListingWhereInput = {};
    if (query.search) {
      where.OR = [
        { itemId: { contains: query.search, mode: 'insensitive' } },
        { userProductId: { contains: query.search, mode: 'insensitive' } },
        { title: { contains: query.search, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: query.search, mode: 'insensitive' } } } }
      ];
      const search=catalogSearch(query.search);
      if(search.kind==='mlb')where.OR=[{itemId:search.term}];
      if(search.kind==='sku')where.OR=[{variants:{some:{OR:[{sku:{equals:search.term,mode:'insensitive'}},...(!search.term.includes('.')?[{sku:{startsWith:search.term+'.',mode:'insensitive' as const}}]:[])]}}},{rawData:{path:['seller_custom_field'],equals:search.term}},{rawData:{path:['attributes'],array_contains:[{id:'SELLER_SKU',value_name:search.term}]}}];
    }
    if (query.status) where.status = query.status;
    if (query.marketplaceAccountId) {
      const selected = await this.prisma.marketplaceAccount.findUnique({ where: { id: query.marketplaceAccountId }, select: { marketplace: true, businessKey: true } });
      if (selected?.marketplace === 'BLING') {
        where.marketplaceAccount = { marketplace: 'MERCADO_LIVRE', businessKey: selected.businessKey };
      } else {
        where.marketplaceAccountId = query.marketplaceAccountId;
      }
    }
    if (query.linked === 'true') where.links = { some: {} };
    if (query.linked === 'false') where.links = { none: {} };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.marketplaceListing.findMany({
        where,
        skip: allRows ? undefined : (query.page - 1) * query.limit,
        take: allRows ? undefined : query.limit,
        orderBy: { updatedAt: 'desc' },
        include: { marketplaceAccount: true, variants: true, links: { include: { product: true, productVariant: true } }, issues: { where: { resolved: false } } }
      }),
      this.prisma.marketplaceListing.count({ where })
    ]);
    return paginate(await applySharedStock(this.prisma, data), query.page, query.limit, total);
  }

  async findOne(id: string) {
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { id },
      include: {
        marketplaceAccount: true,
        variants: true,
        links: { include: { product: true, productVariant: true, listingVariant: true } },
        issues: { where: { resolved: false } }
      }
    });
    if (listing) await applySharedStock(this.prisma, [listing]);
    return listing;
  }
}
