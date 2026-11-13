import { ListingMatcherService } from '../src/mercadolivre/synchronization/listing-matcher.service';

describe('ListingMatcherService', () => {
  it('creates an exact SKU link in batch', async () => {
    const prisma = {
      marketplaceAccount: { findMany: jest.fn().mockResolvedValue([{ id: 'bling-mottum', businessKey: 'mottum' }]) },
      marketplaceListingVariant: { findMany: jest.fn().mockResolvedValue([{ id: 'lv1', listingId: 'l1', sku: 'SKU-1', listing: {} }]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([{ id: 'pv1', productId: 'p1', sku: 'SKU-1' }]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      listingProductLink: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      marketplaceListing: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new ListingMatcherService(prisma as never);
    await expect(service.run()).resolves.toEqual({ reviewCandidates: 0, created: 1 });
    expect(prisma.listingProductLink.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ productId: 'p1', productVariantId: 'pv1', listingId: 'l1', listingVariantId: 'lv1' })],
      skipDuplicates: true
    }));
  });
  it('matches the SELLER_SKU characteristic to the Bling variant of the same business', async () => {
    const prisma = {
      marketplaceAccount: { findMany: jest.fn().mockResolvedValue([{ id: 'bling-mottum', businessKey: 'mottum' }]) },
      marketplaceListingVariant: { findMany: jest.fn().mockResolvedValue([]) },
      marketplaceListing: { findMany: jest.fn().mockResolvedValue([{ id: 'mlb', rawData: { seller_custom_field: 'wrong', attributes: [{ id: 'SELLER_SKU', value_name: '59328.12' }] } }]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([{ id: 'bling-variant', productId: 'product', sku: '59328.12' }]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      listingProductLink: { createMany: jest.fn().mockResolvedValue({ count: 1 }) }
    };
    const service = new ListingMatcherService(prisma as never);
    await service.run('bling-mottum');
    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sku: { in: ['59328.12'] }, blingAccountId: 'bling-mottum' } }));
    expect(prisma.marketplaceListing.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ marketplaceAccount: { marketplace: 'MERCADO_LIVRE', businessKey: 'mottum' } }) }));
    expect(prisma.listingProductLink.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ listingId: 'mlb', productVariantId: 'bling-variant' })] }));
  });
});
