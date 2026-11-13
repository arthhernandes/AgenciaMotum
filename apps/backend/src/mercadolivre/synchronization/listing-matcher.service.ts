import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ListingMatchType } from '@prisma/client';
import { sellerSku } from './seller-sku';

@Injectable()
export class ListingMatcherService {
  private readonly logger = new Logger(ListingMatcherService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(blingAccountId?: string) {
    const accounts = await this.prisma.marketplaceAccount.findMany({ where: { marketplace: 'BLING', ...(blingAccountId ? { id: blingAccountId } : {}) }, select: { id: true, businessKey: true } });
    let created = 0;
    let reviewCandidates = 0;
    for (const account of accounts) {
      const result = await this.matchAccount(account.id, account.businessKey);
      created += result.created;
      reviewCandidates += result.reviewCandidates;
    }
    return { created, reviewCandidates };
  }

  private async matchAccount(blingAccountId: string, businessKey: string) {
    const listingVariants = await this.prisma.marketplaceListingVariant.findMany({
      where: { links: { none: {} }, listing: { marketplaceAccount: { marketplace: 'MERCADO_LIVRE', businessKey } } },
      select: { id: true, listingId: true, sku: true, rawData: true }
    });
    const simpleListings = await this.prisma.marketplaceListing.findMany({
      where: { links: { none: {} }, marketplaceAccount: { marketplace: 'MERCADO_LIVRE', businessKey } },
      select: { id: true, rawData: true }
    });
    const simpleWithSku = simpleListings.map((listing) => ({
      ...listing,
      sku: sellerSku(listing.rawData)
    })).filter((listing): listing is typeof listing & { sku: string } => Boolean(listing.sku));
    for (const variant of listingVariants) variant.sku = sellerSku(variant.rawData) || variant.sku;
    const skus = [...new Set([
      ...listingVariants.map((variant) => variant.sku).filter((sku): sku is string => Boolean(sku)),
      ...simpleWithSku.map((listing) => listing.sku)
    ])];
    const productVariants = skus.length
      ? await this.prisma.productVariant.findMany({ where: { sku: { in: skus }, ...(blingAccountId ? { blingAccountId } : {}) }, select: { id: true, productId: true, sku: true } })
      : [];
    const products = skus.length
      ? await this.prisma.product.findMany({ where: { sku: { in: skus }, ...(blingAccountId ? { blingAccountId } : {}) }, select: { id: true, sku: true } })
      : [];
    const bySku = new Map(productVariants.map((variant) => [variant.sku, variant]));
    const productsBySku = new Map(products.map((product) => [product.sku, product]));
    const links = [
      ...listingVariants.flatMap((listingVariant) => {
        const productVariant = listingVariant.sku ? bySku.get(listingVariant.sku) : undefined;
        const product = listingVariant.sku ? productsBySku.get(listingVariant.sku) : undefined;
        return productVariant || product ? [{
          productId: productVariant?.productId ?? product!.id, productVariantId: productVariant?.id ?? null,
          listingId: listingVariant.listingId, listingVariantId: listingVariant.id,
          matchType: ListingMatchType.SKU, confidence: 100
        }] : [];
      }),
      ...simpleWithSku.flatMap((listing) => {
        const productVariant = bySku.get(listing.sku);
        const product = productsBySku.get(listing.sku);
        return productVariant || product ? [{
          productId: productVariant?.productId ?? product!.id, productVariantId: productVariant?.id ?? null,
          listingId: listing.id, listingVariantId: null,
          matchType: ListingMatchType.SKU, confidence: 100
        }] : [];
      })
    ];
    const result = links.length ? await this.prisma.listingProductLink.createMany({ data: links, skipDuplicates: true }) : { count: 0 };
    const reviewCandidates = listingVariants.length + simpleWithSku.length - result.count;
    this.logger.log(`sku matching created=${result.count} unmatched=${reviewCandidates}`);
    return { reviewCandidates, created: result.count };
  }
}
