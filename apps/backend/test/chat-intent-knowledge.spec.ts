import { INTENT_KNOWLEDGE, interpretIntent, SKU_STRUCTURE_RULE } from '../src/chat/chat-intent-knowledge';
import { ChatIntentKnowledgeService } from '../src/chat/chat-intent-knowledge.service';
describe('Interpretation knowledge base',()=>{
  it.each(['Consulte os dados fiscais deste anúncio','Mostre os dados fiscais do Mercado Livre e o que você sugere','Compare o NCM deste anúncio'])('routes fiscal reading to real fiscal data: %s',request=>{expect(interpretIntent(request).codes).toContain('REVIEW_FISCAL');expect(interpretIntent(request).wholeMissingCatalog).toBe(false);});
  it('stores the parent and dotted variant convention without deriving color or size from suffixes',()=>{
    expect(INTENT_KNOWLEDGE.find(entry=>entry.code==='SKU_STRUCTURE')?.workflow).toBe(SKU_STRUCTURE_RULE);
    expect(SKU_STRUCTURE_RULE).toContain('44866 é o SKU pai');expect(SKU_STRUCTURE_RULE).toContain('44866.13');expect(SKU_STRUCTURE_RULE).toContain('nunca invente sufixos');
    expect(interpretIntent('44866.13 é o SKU de uma variação do produto 44866').codes).toContain('SKU_STRUCTURE');
    expect(interpretIntent('44866 é o SKU pai do produto').wholeMissingCatalog).toBe(false);
  });
  it.each(['Suba as outras cores deste produto com todos os tamanhos','Complete a grade do anúncio conforme a Bling','Crie as variações faltantes deste produto','Cadastre as opções de cor que ainda não aparecem no anúncio','Coloque no anúncio todas as cores que temos no estoque','Inclua as variantes disponíveis no catálogo','Também adicione as cores que faltam ser adicionadas na Bling e não no Mercado Livre'])('routes paraphrases to the same complete-catalog workflow: %s',text=>{
    expect(interpretIntent(text).wholeMissingCatalog).toBe(true);expect(interpretIntent(text).codes).toContain('ADD_VARIATIONS');
  });
  it.each(['Não adicione todas as cores da Bling','Não quero criar variações','Como posso adicionar todas as variações?','Inclua somente a cor Azul P','Adicione todas as cores exceto Amarelo'])('does not authorize whole catalog publication from a negation, question or restricted request: %s',text=>{
    expect(interpretIntent(text).wholeMissingCatalog).toBe(false);
  });
  it('keeps price changes separate from catalog additions',()=>{
    expect(interpretIntent('Deixe o preço deste anúncio em 299,90').codes).toContain('CHANGE_PRICE');expect(interpretIntent('Deixe o preço deste anúncio em 299,90').wholeMissingCatalog).toBe(false);
  });
  it('keeps administrator examples across restarts and rejects edits from other roles',async()=>{
    const rows=new Map<string,any>();let role='ADMIN';
    const prisma:any={user:{findUnique:jest.fn(async()=>({active:true,role}))},auditLog:{
      upsert:jest.fn(async({where,create}:any)=>{if(!rows.has(where.id))rows.set(where.id,structuredClone(create));return rows.get(where.id);}),
      findMany:jest.fn(async()=>[...rows.values()]),findUnique:jest.fn(async({where}:any)=>structuredClone(rows.get(where.id))),
      updateMany:jest.fn(async({where,data}:any)=>{const row=rows.get(where.id);if(JSON.stringify(row.after)!==JSON.stringify(where.after.equals))return {count:0};row.after=structuredClone(data.after);return {count:1};})
    }};
    const service=new ChatIntentKnowledgeService(prisma);await service.onModuleInit();
    await service.addExample('admin','ADD_VARIATIONS','Preencha todos os modelos de cores deste produto');
    const restarted=new ChatIntentKnowledgeService(prisma);await restarted.onModuleInit();
    expect((await restarted.snapshot()).find(entry=>entry.code==='ADD_VARIATIONS')?.examples).toContain('Preencha todos os modelos de cores deste produto');
    expect(interpretIntent('Preencha todos os modelos de cores deste produto',await restarted.snapshot()).wholeMissingCatalog).toBe(true);
    role='VIEWER';await expect(service.addExample('viewer','ADD_VARIATIONS','Outro exemplo de variações')).rejects.toThrow('administradores');
    expect(rows.size).toBe(INTENT_KNOWLEDGE.length);
  });
});
