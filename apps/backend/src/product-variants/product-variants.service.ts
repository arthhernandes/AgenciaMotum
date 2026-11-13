import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductVariantsService {
  constructor(private readonly prisma: PrismaService) {}

  listings(id: string) {
    return this.prisma.listingProductLink.findMany({
      where: { productVariantId: id },
      include: { listing: { include: { marketplaceAccount: true } }, listingVariant: true }
    });
  }
}
