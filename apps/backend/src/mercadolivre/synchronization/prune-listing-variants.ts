import { PrismaService } from '../../prisma/prisma.service';

// Only an explicit provider snapshot can prove that a local variation was removed.
export async function pruneListingVariants(prisma: PrismaService, listingId: string, variations: Array<{ id: number | string }> | undefined) {
  if (!Array.isArray(variations)) return;
  await prisma.marketplaceListingVariant.deleteMany({
    where: { listingId, variationId: { notIn: variations.map(variation => String(variation.id)) } }
  });
}
