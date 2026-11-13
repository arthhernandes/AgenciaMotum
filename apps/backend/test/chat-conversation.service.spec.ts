import { ChatConversationService } from '../src/chat/chat-conversation.service';

describe('Saved chat conversations', () => {
  it('labels listings with the Bling product and parent SKU without marketplace API calls',async()=>{const {service,prisma}=setup();prisma.marketplaceAccount.findFirst.mockResolvedValue({id:'account',businessKey:'mottum'} as any);const listing=jest.fn().mockResolvedValue({variants:[{sku:'44866.1'},{sku:'44866.2'}],rawData:{}});const variants=jest.fn().mockResolvedValue([{sku:'44866.1',product:{id:'p',title:'Polo Bling',sku:'44866'}},{sku:'44866.2',product:{id:'p',title:'Polo Bling',sku:'44866'}}]);Object.assign(prisma,{marketplaceListing:{findFirst:listing},productVariant:{findMany:variants}});const chat=await service.create('account','user');await service.setScope('account','user',chat.id,{mode:'listing',reference:'MLB4369286053'});expect((await service.open('account','user',chat.id)).conversations[0].title).toBe('MLB4369286053 - Polo Bling - 44866');expect(variants).toHaveBeenCalledWith(expect.objectContaining({where:{blingAccountId:'account',sku:{in:['44866.1','44866.2']}}}));});
  it('persists batch cards in the existing message without creating new chat balloons',async()=>{const {service}=setup();const chat=await service.create('account','user');await service.append('account','user',chat.id,[{role:'user',content:'Faça as três ações'},{role:'assistant',content:'Conferindo o lote',batchId:'batch',actions:[]}]);await service.setBatchActions('account','user',chat.id,'batch',[{id:'fiscal'}]);const opened=await service.open('account','user',chat.id);expect(opened.messages).toHaveLength(2);expect(opened.messages[1]).toEqual(expect.objectContaining({batchId:'batch',actions:[{id:'fiscal'}]}));await expect(service.setBatchActions('account','other',chat.id,'batch',[])).rejects.toThrow();});
  const scope = { action: 'CHAT_CONVERSATION', entityType: 'ChatConversation', entityId: 'account', userId: 'user' };
  function setup() {
    const rows: any[] = [];
    const matches = (row: any, where: any) => Object.entries(where).every(([key, value]) => key === 'after' ? JSON.stringify(row.after) === JSON.stringify((value as any).equals) : row[key] === value);
    const prisma = {
      marketplaceAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'account' }) },
      auditLog: {
        create: jest.fn(async ({ data }) => { const row = { ...structuredClone(data), id: `conversation-${rows.length}`, createdAt: new Date() };rows.push(row);return structuredClone(row); }),
        findMany: jest.fn(async ({ where }) => rows.filter(row => matches(row, where)).reverse().map(row => structuredClone(row))),
        findFirst: jest.fn(async ({ where }) => { const row = rows.find(row => matches(row, where));return row ? structuredClone(row) : null; }),
        updateMany: jest.fn(async ({ where, data }) => { const row = rows.find(row => matches(row, where));if (!row) return { count: 0 };Object.assign(row, structuredClone(data));return { count: 1 }; })
      }
    };
    return { prisma, rows, service: new ChatConversationService(prisma as never) };
  }

  it('restores messages and proposal previews from the database after a service restart', async () => {
    const { service, prisma } = setup();
    const conversation = await service.open('account', 'user');
    const messages = [{ role: 'user' as const, content: 'Altere o preço' }, { role: 'assistant' as const, content: 'Confira a proposta', actions: [{ id: 'action', label: 'Alterar preço', preview: [{ mlb: 'MLB123' }] }],toolContext:[{name:'consultar_anuncio_ml',arguments:'{}',output:'{"preco":120}'}] }];
    await service.append('account', 'user', conversation.id, messages);
    const restarted = new ChatConversationService(prisma as never);
    expect((await restarted.open('account', 'user')).messages).toEqual(messages);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: scope }));
  });

  it('persists the selected scope across messages and rejects scope changes from other users', async () => {
    const { service, prisma } = setup();
    const first = await service.create('account', 'user');
    await service.setScope('account', 'user', first.id, { mode: 'product', reference: '  Polo Levis  ' });
    await service.append('account', 'user', first.id, [{ role: 'user', content: 'Adicionar cores' }]);
    const restored = await new ChatConversationService(prisma as never).open('account', 'user', first.id);
    expect(restored.scope).toEqual({ mode: 'product', reference: 'Polo Levis' });
    expect(restored.messages).toHaveLength(1);
    await expect(service.setScope('account', 'other-user', first.id, { mode: 'listing', reference: 'MLB123' })).rejects.toThrow('não encontrada');
  });

  it('updates the existing preview after choosing a chart without adding chat balloons',async()=>{
    const {service}=setup();const conversation=await service.create('account','user');
    await service.append('account','user',conversation.id,[{role:'user',content:'Adicionar cores'},{role:'assistant',content:'Confira a prévia',actions:[{id:'old',preview:[{title:'Amarelo',fields:[]}]}]}]);
    const replacement=[{id:'new',preview:[{title:'Amarelo',fields:[{field:'Tabela de medidas',after:'Guia 2'}]}]}];
    await service.replaceAction('account','user',conversation.id,'old',replacement);
    const restored=await service.open('account','user',conversation.id);
    expect(restored.messages).toHaveLength(2);expect(restored.messages[1].actions).toEqual(replacement);
    await expect(service.replaceAction('account','other',conversation.id,'new',replacement)).rejects.toThrow('não encontrada');
  });
  it('starts a new conversation without deleting the previous one', async () => {
    const { service } = setup();
    const first = await service.create('account', 'user');
    await service.append('account', 'user', first.id, [{ role: 'user', content: 'Primeira conversa' }]);
    const next = await service.create('account', 'user');
    const opened = await service.open('account', 'user');
    expect(opened.id).toBe(next.id);
    expect(opened.messages).toEqual([]);
    expect(opened.conversations).toHaveLength(2);
    expect((await service.open('account', 'user', first.id)).messages[0].content).toBe('Primeira conversa');
  });
  it('labels a conversation by its current scope after the product changes',async()=>{const {service}=setup();const chat=await service.create('account','user');await service.append('account','user',chat.id,[{role:'user',content:'Camiseta Rosa'}]);await service.setScope('account','user',chat.id,{mode:'listing',reference:'MLB4369286053'});const opened=await service.open('account','user',chat.id);expect(opened.conversations.find(value=>value.id===chat.id)?.title).toBe('MLB4369286053');expect(opened.scope.reference).toBe('MLB4369286053');});
  it('includes the selected older conversation even outside the recent list',async()=>{const {service,prisma}=setup();const old=await service.create('account','user');const recent=await service.create('account','user');prisma.auditLog.findMany.mockResolvedValueOnce([recent]);const opened=await service.open('account','user',old.id);expect(opened.id).toBe(old.id);expect(opened.conversations.map(value=>value.id)).toEqual([old.id,recent.id]);});

  it('does not allow another user or account to read or append to a conversation', async () => {
    const { service } = setup();
    const first = await service.create('account', 'user');
    for (const [account, user] of [['account', 'other-user'], ['other-account', 'user']]) {
      await expect(service.open(account, user, first.id)).rejects.toThrow('não encontrada');
      await expect(service.append(account, user, first.id, [{ role: 'user', content: 'Injeção' }])).rejects.toThrow('não encontrada');
    }
  });

  it('retries concurrent updates instead of silently losing messages', async () => {
    const { service, prisma, rows } = setup();
    const first = await service.create('account', 'user');
    prisma.auditLog.updateMany.mockImplementationOnce(async () => { rows[0].after.messages.push({ role: 'assistant', content: 'Outra janela' });return { count: 0 }; });
    await service.append('account', 'user', first.id, [{ role: 'user', content: 'Esta janela' }]);
    expect((await service.open('account', 'user')).messages.map(m => m.content)).toEqual(['Outra janela', 'Esta janela']);
  });
});
