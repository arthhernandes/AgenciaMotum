import { ProductsService } from '../src/products/products.service';
describe('Map listing filters', () => {
  it('includes products linked through a variation, not only the parent', async () => {
    const prisma = { product: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) }, $transaction: jest.fn().mockImplementation(promises => Promise.all(promises)) };
    await new ProductsService(prisma as never).findAll({ page: 1, limit: 50, hasListing: 'true', listingStatus: 'active' });
    const where = prisma.product.findMany.mock.calls.find(([query])=>query.take===50)![0].where;
    expect(where.AND).toContainEqual({ OR: [{ links: { some: { listing: { status: 'active' } } } }, { variants: { some: { links: { some: { listing: { status: 'active' } } } } } }] });
  });
});
