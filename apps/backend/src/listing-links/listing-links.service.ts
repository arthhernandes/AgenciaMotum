import { Injectable } from '@nestjs/common';
import { ListingMatchType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ManualLinkDto } from './dto';

@Injectable()
export class ListingLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async manualLink(dto: ManualLinkDto, userId?: string) {
    const link = await this.prisma.listingProductLink.create({
      data: {
        productId: dto.productId,
        productVariantId: dto.productVariantId,
        listingId: dto.listingId,
        listingVariantId: dto.listingVariantId,
        matchType: ListingMatchType.MANUAL,
        confidence: 100,
        manuallyConfirmed: true
      }
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'MANUAL_LINK', entityType: 'ListingProductLink', entityId: link.id, after: link }
    });
    return link;
  }

  async unlink(id: string, userId?: string) {
    const before = await this.prisma.listingProductLink.findUnique({ where: { id } });
    await this.prisma.listingProductLink.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: { userId, action: 'UNLINK', entityType: 'ListingProductLink', entityId: id, before: before ?? undefined }
    });
    return { id, deleted: true };
  }
}
