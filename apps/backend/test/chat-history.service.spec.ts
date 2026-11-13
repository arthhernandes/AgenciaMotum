import { ChatHistoryQuery, ChatHistoryService } from '../src/chat/chat-history.service';

describe('Persistent action history', () => {
  function setup(rows: any[] = []) {
    const prisma = {
      marketplaceAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'bling-mottum', businessKey: 'mottum' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'bling-mottum', name: 'Motum' }, { id: 'meli-mottum', name: 'Mercado Livre' }]) },
      marketplaceListing: { findMany: jest.fn().mockResolvedValue([{ itemId: 'MLB123' }]) },
      auditLog: { findMany: jest.fn().mockResolvedValue(rows), count: jest.fn().mockResolvedValue(rows.length) },
      syncExecution: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (promises: Promise<unknown>[]) => Promise.all(promises))
    };
    return { prisma, service: new ChatHistoryService(prisma as never) };
  }
  const row = (after: any = {}, before: any = {}) => ({ id: 'history', action: 'CHAT_ACTION', entityId: 'action',
    createdAt: new Date('2026-10-08T17:00:00Z'), user: { name: 'Admin', email: 'admin@example.com' },
    before: { accountId: 'bling-mottum', label: 'Alterar preço', kind: 'marketplace', ...before }, after: { status: 'SUCCESS', ...after } });

  it('requires a valid selected business account', async () => {
    const { service, prisma } = setup();
    prisma.marketplaceAccount.findFirst.mockResolvedValue(null as never);
    await expect(service.find('foreign', new ChatHistoryQuery())).rejects.toThrow('conta válida');
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
  it('scopes logs to the business account, including legacy listing ownership, and excludes detail duplicates', async () => {
    const { service, prisma } = setup();
    await service.find('bling-mottum', new ChatHistoryQuery());
    expect(prisma.marketplaceAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessKey: 'mottum' } }));
    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where.action.in).toContain('CHAT_ACTION');
    expect(where.action.in).not.toContain('CHAT_ML_UPDATE_DETAIL');
    expect(where.AND[0].OR).toContainEqual({ after: { path: ['accountId'], equals: 'bling-mottum' } });
    expect(where.AND[0].OR).toContainEqual(expect.objectContaining({ entityId: { in: ['MLB123'] } }));
    expect(JSON.stringify(where)).not.toContain('outlet4u');
  });
  it('projects only history fields and never returns credentials or arbitrary audit JSON', async () => {
    const { service } = setup([row({ message: 'Verificado.', secret: 'must-not-leak', requested: { accessToken: 'must-not-leak' } },
      { secret: 'must-not-leak', preview: [{ mlb: 'MLB123', title: 'Produto', account: 'Motum', accessToken: 'must-not-leak', fields: [{ field: 'Preço', before: '100', after: '120', secret: 'must-not-leak' }], notes: [] }] })]);
    const result = await service.find('bling-mottum', new ChatHistoryQuery());
    expect(result.data[0].preview[0].fields[0].after).toBe('120');
    expect(result.data[0].user.name).toBe('Admin');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(result.data[0].status).toBe('SUCCESS');
  });
  it('uses the actual background sync outcome instead of reporting start as completion', async () => {
    const { service, prisma } = setup([row({ status: 'STARTED', executionId: 'job' }, { kind: 'sync' })]);
    prisma.syncExecution.findMany.mockResolvedValue([{ id: 'job', status: 'PARTIAL', finishedAt: new Date(), itemsProcessed: 20, errors: 2 }] as never);
    const result = await service.find('bling-mottum', new ChatHistoryQuery());
    expect(prisma.syncExecution.findMany.mock.calls[0][0].where.marketplaceAccountId.in).toEqual(['bling-mottum', 'meli-mottum']);
    expect(result.data[0].status).toBe('PARTIAL');
    expect(result.data[0].message).toBe('20 itens processados · 2 erros.');
  });
  it('shows cancellation as an action that was not executed', async () => {
    const { service } = setup([row({ status: 'CANCELLED' })]);
    const result = await service.find('bling-mottum', new ChatHistoryQuery());
    expect(result.data[0].status).toBe('CANCELLED');
    expect(result.data[0].message).toContain('não foi executada');
  });
  it('includes legacy ML price changes with their prior and requested values', async () => {
    const legacy = { ...row({ status: 'VERIFIED', requested: { price: 150 } }, { price: 100 }), action: 'CHAT_ML_UPDATE', entityId: 'MLB123' };
    const { service } = setup([legacy]);
    const result = await service.find('bling-mottum', new ChatHistoryQuery());
    expect(result.data[0].status).toBe('SUCCESS');
    expect(result.data[0].preview[0].fields).toEqual([{ field: 'Preço', before: '100', after: '150' }]);
  });
  it('filters by action kind and paginates in the database with a bounded page size', async () => {
    const { service, prisma } = setup();
    const query = Object.assign(new ChatHistoryQuery(), { page: 2, limit: 200, kind: 'sync' });
    const result = await service.find('bling-mottum', query);
    expect(prisma.auditLog.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({ skip: 50, take: 50 }));
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.AND[1]).toEqual({ before: { path: ['kind'], equals: 'sync' } });
    expect(result.pagination.limit).toBe(50);
  });
});
