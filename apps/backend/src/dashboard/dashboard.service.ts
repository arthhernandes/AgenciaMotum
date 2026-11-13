import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(marketplaceAccountId?: string) {
    const listingWhere = marketplaceAccountId ? { marketplaceAccountId } : {};
    const issueWhere = marketplaceAccountId ? { resolved: false, marketplaceAccountId } : { resolved: false };
    const [products, variants, listings, accounts, openIssues, lastSync] = await this.prisma.$transaction([
      this.prisma.product.count({ where: marketplaceAccountId ? { blingAccountId: marketplaceAccountId } : {} }),
      this.prisma.productVariant.count({ where: marketplaceAccountId ? { blingAccountId: marketplaceAccountId } : {} }),
      this.prisma.marketplaceListing.count({ where: listingWhere }),
      this.prisma.marketplaceAccount.count({ where: { active: true, ...(marketplaceAccountId ? { id: marketplaceAccountId } : {}) } }),
      this.prisma.auditIssue.count({ where: issueWhere }),
      this.prisma.syncExecution.findFirst({ where: marketplaceAccountId ? { marketplaceAccountId } : {}, orderBy: { createdAt: 'desc' } })
    ]);
    const bySeverity = await this.prisma.auditIssue.groupBy({ by: ['severity'], where: issueWhere, _count: true });
    return { products, variants, listings, accounts, openIssues, bySeverity, lastSync };
  }
}
