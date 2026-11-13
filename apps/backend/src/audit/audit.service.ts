import { Injectable } from '@nestjs/common';
import { AuditIssueType, AuditSeverity, Prisma } from '@prisma/client';
import { PaginationQuery, paginate } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AdsAuditQuery } from './dto';

type AuditRow = {
  id: string;
  skuBase: string;
  produto: string;
  quantidadeVariacoes: bigint;
  totalAnuncios: bigint;
  status: 'SEM_ANUNCIO' | 'OK' | 'POSSIVEL_DUPLICIDADE';
  variacoes: string[];
  canais: Array<{ marketplace: string; conta: string; quantidade: number; anuncios: Array<{ id: string; status: string }> }>;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async findIssues(query: PaginationQuery & { type?: AuditIssueType; severity?: AuditSeverity; status?: string; sku?: string }) {
    const where: Prisma.AuditIssueWhereInput = { resolved: query.status === 'resolved' ? true : false };
    if (query.type) where.type = query.type;
    if (query.severity) where.severity = query.severity;
    if (query.sku) where.OR = [
      { product: { sku: { contains: query.sku, mode: 'insensitive' } } },
      { productVariant: { sku: { contains: query.sku, mode: 'insensitive' } } }
    ];
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditIssue.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        include: { product: true, productVariant: true, listing: { include: { marketplaceAccount: true } }, listingVariant: true }
      }),
      this.prisma.auditIssue.count({ where })
    ]);
    return paginate(data, query.page, query.limit, total);
  }

  summary() {
    return this.prisma.auditIssue.groupBy({ by: ['type', 'severity'], where: { resolved: false }, _count: true });
  }

  async findAdsAudit(query: AdsAuditQuery) {
    const search = query.search?.trim() || null;
    const skuBase = query.skuBase?.trim() || null;
    const marketplace = query.marketplace?.trim() || null;
    const conta = query.conta?.trim() || null;
    const accountId = query.marketplaceAccountId?.trim() || null;
    const requestedStatus = query.somenteSemAnuncio
      ? 'SEM_ANUNCIO'
      : query.somenteDuplicidades ? 'POSSIVEL_DUPLICIDADE' : query.status ?? null;
    const offset = (query.page - 1) * query.limit;

    // Product.sku is the catalog's base SKU. ProductVariant.productId is the
    // authoritative parent/variation relationship; no SKU suffix is stripped.
    // A unique ad is marketplace account + MarketplaceListing.itemId.
    const rows = await this.prisma.$queryRaw<AuditRow[]>(Prisma.sql`
      WITH unique_ads AS (
        SELECT DISTINCT
          COALESCE(l."productId", pv."productId") AS "productId",
          ml."marketplaceAccountId" AS "accountId",
          ma.marketplace::text AS marketplace,
          COALESCE(ma.nickname, ma.name) AS conta,
          ml."itemId" AS "adId",
          ml.status
        FROM "ListingProductLink" l
        LEFT JOIN "ProductVariant" pv ON pv.id = l."productVariantId"
        JOIN "MarketplaceListing" ml ON ml.id = l."listingId"
        JOIN "MarketplaceAccount" ma ON ma.id = ml."marketplaceAccountId"
        WHERE COALESCE(l."productId", pv."productId") IS NOT NULL
          AND (${accountId}::text IS NULL OR ml."marketplaceAccountId" = ${accountId})
      ), channel_counts AS (
        SELECT "productId", "accountId", marketplace, conta,
          COUNT(*)::int AS quantidade,
          jsonb_agg(jsonb_build_object('id', "adId", 'status', status) ORDER BY "adId") AS anuncios
        FROM unique_ads GROUP BY "productId", "accountId", marketplace, conta
      ), base AS (
        SELECT p.id, p.sku AS "skuBase", p.title AS produto,
          COUNT(DISTINCT pv.id) AS "quantidadeVariacoes",
          COUNT(DISTINCT (ua."accountId", ua."adId")) AS "totalAnuncios",
          CASE WHEN COUNT(DISTINCT ua."adId") = 0 THEN 'SEM_ANUNCIO'
               WHEN COALESCE(MAX(cc.quantidade), 0) > 1 THEN 'POSSIVEL_DUPLICIDADE'
               ELSE 'OK' END AS status,
          COALESCE(array_agg(DISTINCT pv.sku) FILTER (WHERE pv.sku IS NOT NULL), ARRAY[]::text[]) AS variacoes,
          COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
            'marketplace', cc.marketplace, 'conta', cc.conta,
            'quantidade', cc.quantidade, 'anuncios', cc.anuncios
          )) FILTER (WHERE cc."accountId" IS NOT NULL), '[]'::jsonb) AS canais
        FROM "Product" p
        LEFT JOIN "ProductVariant" pv ON pv."productId" = p.id
        LEFT JOIN unique_ads ua ON ua."productId" = p.id
        LEFT JOIN channel_counts cc ON cc."productId" = p.id
        WHERE (${accountId}::text IS NULL OR p."blingAccountId" = ${accountId})
        GROUP BY p.id
      )
      SELECT *, COUNT(*) OVER() AS "filteredTotal"
      FROM base b
      WHERE (${skuBase}::text IS NULL OR b."skuBase" ILIKE '%' || ${skuBase} || '%')
        AND (${search}::text IS NULL OR b."skuBase" ILIKE '%' || ${search} || '%' OR b.produto ILIKE '%' || ${search} || '%')
        AND (${requestedStatus}::text IS NULL OR b.status = ${requestedStatus})
        AND (${marketplace}::text IS NULL OR EXISTS (
          SELECT 1 FROM unique_ads f WHERE f."productId" = b.id AND f.marketplace ILIKE '%' || ${marketplace} || '%'
        ))
        AND (${conta}::text IS NULL OR EXISTS (
          SELECT 1 FROM unique_ads f WHERE f."productId" = b.id AND f.conta ILIKE '%' || ${conta} || '%'
        ))
      ORDER BY b."skuBase"
      LIMIT ${query.limit} OFFSET ${offset}
    `) as Array<AuditRow & { filteredTotal: bigint }>;

    const [summary] = await this.prisma.$queryRaw<Array<{
      totalSkusBase: bigint; skusComAnuncio: bigint; skusSemAnuncio: bigint; skusComPossivelDuplicidade: bigint;
    }>>(Prisma.sql`
      WITH per_channel AS (
        SELECT COALESCE(l."productId", pv."productId") AS "productId", ml."marketplaceAccountId", COUNT(DISTINCT ml."itemId") AS amount
        FROM "ListingProductLink" l
        LEFT JOIN "ProductVariant" pv ON pv.id = l."productVariantId"
        JOIN "MarketplaceListing" ml ON ml.id = l."listingId"
        WHERE COALESCE(l."productId", pv."productId") IS NOT NULL
          AND (${accountId}::text IS NULL OR ml."marketplaceAccountId" = ${accountId})
        GROUP BY COALESCE(l."productId", pv."productId"), ml."marketplaceAccountId"
      ), per_product AS (
        SELECT p.id, COALESCE(SUM(pc.amount), 0) AS ads, COALESCE(MAX(pc.amount), 0) AS max_channel
        FROM "Product" p LEFT JOIN per_channel pc ON pc."productId" = p.id
        WHERE (${accountId}::text IS NULL OR p."blingAccountId" = ${accountId}) GROUP BY p.id
      ) SELECT COUNT(*) AS "totalSkusBase",
        COUNT(*) FILTER (WHERE ads > 0) AS "skusComAnuncio",
        COUNT(*) FILTER (WHERE ads = 0) AS "skusSemAnuncio",
        COUNT(*) FILTER (WHERE max_channel > 1) AS "skusComPossivelDuplicidade"
      FROM per_product
    `);
    const totalSkusBase = Number(summary?.totalSkusBase ?? 0);
    const skusComAnuncio = Number(summary?.skusComAnuncio ?? 0);
    return {
      resumo: {
        totalSkusBase,
        skusComAnuncio,
        skusSemAnuncio: Number(summary?.skusSemAnuncio ?? 0),
        skusComPossivelDuplicidade: Number(summary?.skusComPossivelDuplicidade ?? 0),
        coberturaPercentual: totalSkusBase ? Number(((skusComAnuncio / totalSkusBase) * 100).toFixed(2)) : 0
      },
      data: rows.map(({ filteredTotal: _filteredTotal, ...row }) => ({
        ...row,
        quantidadeVariacoes: Number(row.quantidadeVariacoes),
        totalAnuncios: Number(row.totalAnuncios)
      })),
      pagination: {
        page: query.page, limit: query.limit,
        total: Number(rows[0]?.filteredTotal ?? 0),
        pages: Math.ceil(Number(rows[0]?.filteredTotal ?? 0) / query.limit) || 1
      }
    };
  }
}
