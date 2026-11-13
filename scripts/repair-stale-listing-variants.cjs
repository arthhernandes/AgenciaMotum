require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');
  const itemIds = process.argv.slice(2).filter(value => value !== '--apply');
  if (!itemIds.length || itemIds.some(value => !/^MLB\d+$/.test(value))) throw new Error('Informe os MLBs a conferir. Use --apply para reparar o cache local.');
  for (const itemId of itemIds) {
    const listings = await prisma.marketplaceListing.findMany({ where: { itemId } });
    for (const listing of listings) {
      const snapshot = listing.rawData;
      if (snapshot?.id !== itemId || !Array.isArray(snapshot.variations)) throw new Error('Snapshot sem grade explícita: ' + itemId);
      const currentIds = snapshot.variations.map(value => String(value.id));
      if (currentIds.some(value => !/^\d+$/.test(value))) throw new Error('ID de variação inválido: ' + itemId);
      const result = await prisma.$transaction(async tx => {
        const current = await tx.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
        if (JSON.stringify(current.rawData) !== JSON.stringify(snapshot)) throw new Error('O anúncio mudou durante a conferência. Execute novamente.');
        const where = { listingId: listing.id, variationId: { notIn: currentIds } };
        const stale = await tx.marketplaceListingVariant.findMany({ where, include: { links: true } });
        if (apply && stale.length) {
          // Preserve the removed cache rows and correspondences for traceability.
          await tx.auditLog.create({ data: {
            action: 'STALE_LISTING_VARIANTS_REPAIR', entityType: 'MarketplaceListing', entityId: listing.id,
            before: JSON.parse(JSON.stringify(stale)), after: { itemId, currentVariationIds: currentIds, snapshotSyncedAt: listing.lastSyncedAt?.toISOString() }
          } });
          await tx.marketplaceListingVariant.deleteMany({ where: { ...where, id: { in: stale.map(value => value.id) } } });
        }
        return { itemId, current: currentIds.length, stale: stale.length, applied: apply };
      });
      console.log(JSON.stringify(result));
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
