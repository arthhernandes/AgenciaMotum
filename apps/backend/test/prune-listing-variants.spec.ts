import { pruneListingVariants } from '../src/mercadolivre/synchronization/prune-listing-variants';
import { MercadoLivreSyncService } from '../src/mercadolivre/synchronization/mercadolivre-sync.service';

describe('removed Mercado Livre variations', () => {
  const setup = () => ({ marketplaceListingVariant: { deleteMany: jest.fn(), upsert: jest.fn() }, marketplaceListing: { upsert: jest.fn().mockResolvedValue({id:'listing'}) } });
  it('preserves local rows when the response omits variations', async () => {
    const prisma = setup();
    await pruneListingVariants(prisma as any, 'listing', undefined);
    expect(prisma.marketplaceListingVariant.deleteMany).not.toHaveBeenCalled();
  });
  it('removes every old variation when the provider explicitly returns no variations', async () => {
    const prisma = setup();
    await pruneListingVariants(prisma as any, 'listing', []);
    expect(prisma.marketplaceListingVariant.deleteMany).toHaveBeenCalledWith({where:{listingId:'listing',variationId:{notIn:[]}}});
  });
  it('refreshes current variations and prunes only obsolete IDs in that listing during sync', async () => {
    const prisma = setup();
    const service = new MercadoLivreSyncService(prisma as any, {} as any, {} as any, {} as any, {} as any);
    await (service as any).upsertItem('account', {id:'MLB1',variations:[{id:10},{id:20}]});
    expect(prisma.marketplaceListingVariant.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.marketplaceListingVariant.deleteMany).toHaveBeenCalledWith({where:{listingId:'listing',variationId:{notIn:['10','20']}}});
  });
});
