import { BadRequestException, Injectable } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Prisma } from '@prisma/client';
import { paginate, PaginationQuery } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { groupSavedVariantPreviews } from './chat-variant-preview';

export class ChatHistoryQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(['all', 'marketplace', 'sync', 'link', 'cancelled'])
  kind = 'all';
}

@Injectable()
export class ChatHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async find(accountId: string, query: ChatHistoryQuery) {
    const business = await this.prisma.marketplaceAccount.findFirst({ where: { id: accountId, marketplace: 'BLING', active: true }, select: { id: true, businessKey: true, name: true } });
    if (!business) throw new BadRequestException('Selecione uma conta válida para consultar o histórico.');
    const accounts = await this.prisma.marketplaceAccount.findMany({ where: { businessKey: business.businessKey }, select: { id: true, name: true } });
    const accountIds = accounts.map(a => a.id);
    // Older ML records had no account metadata after completion. Scope those
    // records through the local listing ownership rather than returning all logs.
    const listings = await this.prisma.marketplaceListing.findMany({ where: { marketplaceAccountId: { in: accountIds } }, select: { itemId: true } });
    const actions = ['CHAT_ACTION', 'CHAT_ML_UPDATE', 'CHAT_ML_CREATE', 'CHAT_LINK_SKU'];
    const scope: Prisma.AuditLogWhereInput[] = accountIds.flatMap(id => [
      { before: { path: ['accountId'], equals: id } }, { after: { path: ['accountId'], equals: id } }
    ]);
    if (listings.length) scope.push({ action: { in: ['CHAT_ML_UPDATE', 'CHAT_ML_CREATE'] }, entityType: 'MarketplaceListing', entityId: { in: listings.map(l => l.itemId) } });
    const where: Prisma.AuditLogWhereInput = { action: { in: actions }, AND: [{ OR: scope }] };
    const filters: Record<string, Prisma.AuditLogWhereInput> = {
      marketplace: { OR: [{ action: { in: ['CHAT_ML_UPDATE', 'CHAT_ML_CREATE'] } }, { before: { path: ['kind'], equals: 'marketplace' } }] },
      sync: { before: { path: ['kind'], equals: 'sync' } },
      link: { OR: [{ action: 'CHAT_LINK_SKU' }, { before: { path: ['kind'], equals: 'link' } }] },
      cancelled: { after: { path: ['status'], equals: 'CANCELLED' } }
    };
    if (filters[query.kind]) (where.AND as Prisma.AuditLogWhereInput[]).push(filters[query.kind]);
    const limit = Math.min(query.limit, 50);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * limit, take: limit,
        select: { id: true, action: true, entityId: true, before: true, after: true, createdAt: true, user: { select: { name: true, email: true } } } }),
      this.prisma.auditLog.count({ where })
    ]);
    const executionIds = rows.map(r => this.object(r.after).executionId).filter((id): id is string => typeof id === 'string');
    const executions = executionIds.length ? await this.prisma.syncExecution.findMany({ where: { id: { in: executionIds }, marketplaceAccountId: { in: accountIds } },
      select: { id: true, status: true, finishedAt: true, itemsProcessed: true, errors: true } }) : [];
    const jobs = new Map(executions.map(e => [e.id, e]));
    const publicationIds=rows.map(row=>this.object(row.after).publicationJobId).filter((id):id is string=>typeof id==='string');
    const publications=publicationIds.length?await this.prisma.auditLog.findMany({where:{id:{in:publicationIds},action:'CHAT_FAMILY_PUBLICATION_JOB',before:{path:['accountId'],equals:business.id}},select:{id:true,after:true}}):[];
    const publicationJobs=new Map(publications.map(row=>[row.id,this.object(row.after)]));
    const name = business.name;
    return paginate(rows.map(row => {
      const before = this.object(row.before), after = this.object(row.after);
      const job = jobs.get(after.executionId);
      const publication=publicationJobs.get(after.publicationJobId);
      const kind = row.action === 'CHAT_ACTION' ? before.kind : row.action === 'CHAT_LINK_SKU' ? 'link' : 'marketplace';
      const previews = groupSavedVariantPreviews(this.previews(before.preview));
      if (!previews.length && kind === 'marketplace') previews.push(this.legacyPreview(row.entityId, before, after, name));
      const status = publication ? publication.status==='COMPLETE'?'SUCCESS':publication.status==='FAILED'?'FAILED':publication.status==='WAITING_DATA'?'PAUSED':'RUNNING' : job?.status ?? after.status ?? (row.action === 'CHAT_LINK_SKU' ? 'SUCCESS' : 'UNVERIFIED');
      const source = before.source === 'BLING' ? 'Bling' : 'Mercado Livre';
      const label = this.text(before.label) || (row.action === 'CHAT_ML_CREATE' ? 'Publicar anúncio no Mercado Livre' : kind === 'link' ? 'Vincular anúncio ao SKU' : kind === 'sync' ? `Sincronizar ${source}` : 'Alterar anúncio no Mercado Livre');
      return {
        id: row.id, createdAt: row.createdAt, completedAt: job?.finishedAt ?? (this.text(after.completedAt) || null),
        label, kind, status: this.status(status), account: name, user: row.user ?? { name: 'Usuário removido', email: '' },
        message: publication ? this.text(publication.blockedReason)||`${(publication.rows??[]).filter((row:any)=>['ACTIVE','PUBLISHED_NO_STOCK'].includes(row.status)).length}/${(publication.rows??[]).length} variações publicadas · ${(publication.rows??[]).filter((row:any)=>row.status==='ACTIVE').length} ativas · ${(publication.rows??[]).filter((row:any)=>['NO_STOCK','PUBLISHED_NO_STOCK'].includes(row.status)).length} sem estoque` : job ? `${job.itemsProcessed} itens processados · ${job.errors} erros.` : this.text(after.message) || this.defaultMessage(status),
        preview: previews,
        reference: this.text(before.mlb) || this.text(after.mlb) || (row.action === 'CHAT_ACTION' ? '' : row.entityId),
        sku: this.text(before.sku) || this.text(after.sku),
        destination: kind === 'sync' ? '/sincronizacoes' : kind === 'link' ? '/mapa' : '/anuncios',
        results: Array.isArray(after.results) ? after.results.map((r: any) => ({ mlb: this.text(r.mlb), success: r.success === true, message: this.text(r.message) })) : []
      };
    }), query.page, limit, total);
  }

  private object(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
  private text(value: unknown): string { return typeof value === 'string' ? value : ''; }

  private previews(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.map(p => ({ mlb: this.text(p.mlb), title: this.text(p.title), account: this.text(p.account),
      fields: Array.isArray(p.fields) ? p.fields.map((f: any) => ({ field: this.text(f.field), before: this.text(f.before), after: this.text(f.after) })) : [],
      notes: Array.isArray(p.notes) ? p.notes.filter((n: unknown) => typeof n === 'string') : [] }));
  }

  private legacyPreview(mlb: string, before: Record<string, any>, after: Record<string, any>, account: string) {
    const requested = this.object(after.requested);
    const names: Record<string, string> = { price: 'Preço', available_quantity: 'Estoque', status: 'Status', title: 'Título', family_name: 'Nome da família', pictures: 'Fotos', attributes: 'Atributos', variations: 'Variações' };
    const fields = Object.keys(names).filter(key => key in requested).map(key => ({ field: names[key], before: this.value(before[key === 'available_quantity' ? 'quantity' : key]), after: this.value(requested[key]) }));
    if (after.description != null) fields.push({ field: 'Descrição', before: 'Não registrada', after: this.text(after.description) });
    return { mlb, title: this.text(before.title), account, fields, notes: [] as string[] };
  }

  private value(value: unknown) { return value == null ? 'Não registrado' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
  private status(status: string) {
    const map: Record<string, string> = { VERIFIED: 'SUCCESS', STARTED: 'RUNNING', PENDING: 'UNVERIFIED' };
    return map[status] ?? (['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED', 'UNVERIFIED', 'PAUSED'].includes(status) ? status : 'UNVERIFIED');
  }
  private defaultMessage(status: string) {
    if (['SUCCESS', 'VERIFIED'].includes(status)) return 'Ação concluída.';
    if (status === 'CANCELLED') return 'Proposta cancelada; a ação não foi executada.';
    if (status === 'FAILED') return 'A ação não pôde ser concluída.';
    if (['RUNNING', 'STARTED'].includes(status)) return 'Execução em andamento.';
    return 'Resultado não verificado. Consulte o anúncio antes de repetir a ação.';
  }
}
