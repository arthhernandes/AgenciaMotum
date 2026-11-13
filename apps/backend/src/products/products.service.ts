import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginate } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { ProductQueryDto } from './dto';
import { applySharedStock } from '../bling/synchronization/shared-stock';
import { catalogSearch } from '../common/catalog-search';
import { parentPlaceholderIds } from './catalog-parent-duplicates';
import { sortProductsByAnnouncements } from './sort-products';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ProductQueryDto) {
    const where: Prisma.ProductWhereInput = {
      AND: [
        { sku: { not: { contains: '.' } } },
        {
          OR: [
            { sku: { not: { contains: '-' } } },
            { sku: { endsWith: '-LINHA1', mode: 'insensitive' } },
            { sku: { endsWith: '-LINHA2', mode: 'insensitive' } }
          ]
        },
        { sku: { not: { startsWith: 'MLB' } } }
      ]
    };
    if (query.marketplaceAccountId) where.blingAccountId = query.marketplaceAccountId;
    const catalog=await this.prisma.product.findMany({where:query.marketplaceAccountId?{blingAccountId:query.marketplaceAccountId}:{},select:{id:true,blingAccountId:true,sku:true,_count:{select:{links:true}},variants:{select:{sku:true,color:true,size:true,_count:{select:{links:true}}}}}});
    const placeholders=parentPlaceholderIds(catalog);
    if(placeholders.length)where.id={notIn:placeholders};
    if (query.search) {
      const search=catalogSearch(query.search);
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: query.search, mode: 'insensitive' } } } },
        { variants: { some: { links: { some: { listing: { itemId: { contains: query.search, mode: 'insensitive' } } } } } } },
        { variants: { some: { links: { some: { listing: { userProductId: { contains: query.search, mode: 'insensitive' } } } } } } },
        { links: { some: { listing: { itemId: { contains: query.search, mode: 'insensitive' } } } } },
        { links: { some: { listing: { userProductId: { contains: query.search, mode: 'insensitive' } } } } }
      ];
      if(search.kind==='sku')where.OR=[{sku:{equals:search.term,mode:'insensitive'}},{variants:{some:{OR:[{sku:{equals:search.term,mode:'insensitive'}},...(!search.term.includes('.')?[{sku:{startsWith:search.term+'.',mode:'insensitive' as const}}]:[])]}}}];
      if(search.kind==='mlb')where.OR=[{links:{some:{listing:{itemId:search.term}}}},{variants:{some:{links:{some:{listing:{itemId:search.term}}}}}}];
    }
    if (query.sku) where.variants = { some: { sku: { contains: query.sku, mode: 'insensitive' } } };
    if (query.brand) where.brand = { contains: query.brand, mode: 'insensitive' };
    if (query.hasIssues === 'true') where.issues = { some: { resolved: false } };
    const listingFilter: Prisma.ListingProductLinkWhereInput = {};
    if (query.listingStatus) listingFilter.listing = { status: query.listingStatus };
    if (query.hasListing === 'false') {
      where.links = { none: listingFilter };
      where.variants = { ...where.variants, every: { links: { none: listingFilter } } };
    } else if (query.hasListing === 'true' || query.listingStatus) {
      where.AND = [...(where.AND as Prisma.ProductWhereInput[]), { OR: [{ links: { some: listingFilter } }, { variants: { some: { links: { some: listingFilter } } } }] }];
    }

    let orderedIds:string[]|undefined;
    if(query.sortBy==='listings'){
      const listingSelect={select:{id:true,itemId:true,marketplaceAccountId:true,rawData:true}};
      const ranking=await this.prisma.product.findMany({where,select:{id:true,sku:true,links:{where:listingFilter,select:{listing:listingSelect}},variants:{select:{links:{where:listingFilter,select:{listing:listingSelect}}}}}});
      orderedIds=sortProductsByAnnouncements(ranking,query.sortDirection??'desc').map(product=>product.id).slice((query.page-1)*query.limit,query.page*query.limit);
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where:orderedIds?{...where,id:{in:orderedIds}}:where,
        skip: orderedIds?0:(query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          variants: {
            include: {
              links: { where: listingFilter, include: { listing: { include: { marketplaceAccount: true } }, listingVariant: true } }
            }
          },
          issues: { where: { resolved: false } },
          links: { where: listingFilter, include: { listing: { include: { marketplaceAccount: true } }, listingVariant: true } }
        }
      }),
      this.prisma.product.count({ where })
    ]);

    if(orderedIds){const order=new Map(orderedIds.map((id,index)=>[id,index]));data.sort((a,b)=>order.get(a.id)!-order.get(b.id)!);}
    return paginate(await applySharedStock(this.prisma, data), query.page, query.limit, total);
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        variants: {
          include: {
            links: { include: { listing: { include: { marketplaceAccount: true } }, listingVariant: true } },
            issues: { where: { resolved: false } }
          }
        },
        links: { include: { listing: { include: { marketplaceAccount: true, variants: true } }, listingVariant: true } },
        issues: { where: { resolved: false } }
      }
    });
    if (product) await applySharedStock(this.prisma, [product]);
    return product;
  }

  listings(id: string) {
    return this.prisma.listingProductLink.findMany({
      where: { productId: id },
      include: { listing: { include: { marketplaceAccount: true, variants: true } }, listingVariant: true }
    });
  }
}
