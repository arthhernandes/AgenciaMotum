import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { AuditIssueType, AuditSeverity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_LOCK, IssueCandidate, persistIssueState } from './audit-issue-state';

@Injectable()
export class AuditEngineService {
  private readonly logger = new Logger(AuditEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run() {
    this.logger.log('audit started');
    return this.prisma.$transaction(async tx=>{
      const [lock]=await tx.$queryRaw<Array<{locked:boolean}>>`SELECT pg_try_advisory_xact_lock(${AUDIT_LOCK}::bigint) AS locked`;
      if(!lock.locked)throw new ConflictException('Ja existe uma auditoria ou manutencao de alertas em andamento.');
      const candidates:IssueCandidate[]=[];
      const addIssue=(type:AuditIssueType,severity:AuditSeverity,title:string,description:string,refs:Omit<IssueCandidate,'type'|'severity'|'title'|'description'>)=>{candidates.push({type,severity,title,description,...refs});};

      const variants = await tx.productVariant.findMany({
        select: { id:true, productId:true, sku:true, stock:true, links:{select:{
          listingId:true, listingVariantId:true,
          listing:{select:{status:true,availableQuantity:true}},
          listingVariant:{select:{availableQuantity:true}}
        }} }
      });
      for (const variant of variants) {
        if (variant.stock > 0 && variant.links.length === 0) {
          addIssue(AuditIssueType.NO_LISTING, AuditSeverity.ERROR, 'Produto com estoque sem anúncio', `SKU ${variant.sku} tem estoque Bling e nenhum anúncio relacionado.`, { productId: variant.productId, productVariantId: variant.id });
        }
        for (const link of variant.links) {
          const listingStock = link.listingVariant?.availableQuantity ?? link.listing.availableQuantity;
          if (variant.stock > 0 && link.listing.status.toLowerCase() === 'paused') {
            addIssue(AuditIssueType.PAUSED_WITH_STOCK, AuditSeverity.WARNING, 'Anúncio pausado com estoque', `SKU ${variant.sku} tem estoque e anúncio pausado.`, { productId: variant.productId, productVariantId: variant.id, listingId: link.listingId, listingVariantId: link.listingVariantId });
          }
          if (variant.stock !== listingStock) {
            addIssue(AuditIssueType.STOCK_DIVERGENCE, AuditSeverity.WARNING, 'Divergência de estoque', `SKU ${variant.sku}: Bling ${variant.stock}, Mercado Livre ${listingStock}.`, { productId: variant.productId, productVariantId: variant.id, listingId: link.listingId, listingVariantId: link.listingVariantId, metadata: { blingStock: variant.stock, marketplaceStock: listingStock } });
          }
          if (variant.stock > 0 && link.listing.status.toLowerCase() === 'closed') {
            addIssue(AuditIssueType.CLOSED_WITH_STOCK, AuditSeverity.ERROR, 'Anúncio encerrado com produto disponível', `SKU ${variant.sku} possui anúncio encerrado e estoque disponível.`, { productId: variant.productId, productVariantId: variant.id, listingId: link.listingId });
          }
        }
        if (variant.links.length > 1) {
          addIssue(AuditIssueType.DUPLICATE_LISTING, AuditSeverity.WARNING, 'Possível anúncio duplicado', `SKU ${variant.sku} está relacionado a múltiplos anúncios.`, { productId: variant.productId, productVariantId: variant.id });
        }
      }

      const unlinkedListings = await tx.marketplaceListing.findMany({ where: { links: { none: {} } },select:{id:true,itemId:true,marketplaceAccountId:true} });
      for (const listing of unlinkedListings) {
        addIssue(AuditIssueType.UNLINKED_LISTING, AuditSeverity.WARNING, 'Anúncio sem relacionamento', `${listing.itemId} não está vinculado a produto/SKU Bling.`, { listingId: listing.id, marketplaceAccountId: listing.marketplaceAccountId });
      }

      const state=await persistIssueState(tx,candidates,new Date());
      this.logger.log(`audit finished active=${state.active} inserted=${state.inserted}`);
      return {created:state.active,...state};
    },{timeout:120000,maxWait:5000});
  }
}
