import { of, throwError } from 'rxjs';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ChatService } from '../src/chat/chat.service';

describe('Operational chat', () => {
  it('does not query the AI or providers for product costs without cost permission',async()=>{const {service,prisma,http,marketplace}=setup();prisma.user.findUnique.mockResolvedValue({active:true,role:'CONSULTANT',permissions:['listings.view']});const result=await service.reply([{role:'user',content:'Qual o custo do produto 5586?'}],'bling-mottum','user');expect(result.message).toContain('permissão para visualizar custos');expect(http.post).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();});
  it('removes historical cost disclosures before sending the conversation back to the AI',async()=>{const {service,prisma,http}=setup();prisma.user.findUnique.mockResolvedValue({active:true,role:'CONSULTANT',permissions:['listings.view']});http.post.mockReturnValue(output([answer]));await service.reply([{role:'user',content:'Consulta anterior'},{role:'assistant',content:'O custo é R$ 45,90.'},{role:'user',content:'Olá'}],'bling-mottum','user');expect(http.post).toHaveBeenCalled();expect(JSON.stringify(http.post.mock.calls)).not.toContain('45,90');});
  it('creates a multi-product plan instead of routing only its first requested action',async()=>{const {service,http,marketplace}=setup();const create=jest.fn().mockResolvedValue({id:'batch'});(service as any).batches={create};const result=await service.reply([{role:'user',content:'Adicione as variações ausentes, revise dados fiscais e use os preços da Bling'}],'bling-mottum','user',{scope:{mode:'multiple',reference:'Polo marrom;Camiseta rosa'},earlierRequests:'',userRequests:'Adicione variações, revise fiscais e use preços Bling'});expect(create).toHaveBeenCalledWith('bling-mottum','user',{references:['Polo marrom','Camiseta rosa'],stages:['variations','fiscal','price'],priceSource:'bling'});expect(result).toHaveProperty('batchId','batch');expect(http.post).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();});
  it('prepares separate Bling prices for different products with the right stage association',async()=>{const {service,bling,marketplace}=setup();(bling as any).fiscalProductForSku=jest.fn(async(_account,sku)=>({salePrice:sku==='1'?129.9:249.9}));(marketplace as any).fiscalSources=jest.fn(async(_account,reference)=>[{item:{id:reference,seller_custom_field:reference==='MLB1'?'1':'2'}}]);(marketplace as any).prepareNamedUpdate=jest.fn(async(_account,_user,args)=>({kind:'update',targets:[{mlb:args.anuncio,body:{price:args.preco},preview:{mlb:args.anuncio,title:args.anuncio,account:'Mercado Livre',fields:[],notes:[]}}]}));const first=await (service as any).prepareBatchStage({id:'row1',reference:'MLB1',title:'Polo',tasks:[],priceSource:'bling'},'price','bling-mottum','user','batch');const second=await (service as any).prepareBatchStage({id:'row2',reference:'MLB2',title:'Camiseta',tasks:[],priceSource:'bling'},'price','bling-mottum','user','batch');expect((marketplace as any).prepareNamedUpdate.mock.calls.map((call:any)=>call[2].preco)).toEqual([129.9,249.9]);expect(first.card.batchKey).toBe('batch|row1|price');expect(second.card.batchKey).toBe('batch|row2|price');expect(marketplace.execute).not.toHaveBeenCalled();});
  it('requires new review if automation changes before the final price step',async()=>{const {service,marketplace}=setup();const row:any={id:'row',reference:'MLB1',title:'Polo',price:129.9,priceSource:'fixed',tasks:[{stage:'variations',status:'SUCCESS'}]};const old={id:'old-price',kind:'marketplace',label:'Preço',batchKey:'batch|row|price',accountId:'bling-mottum',userId:'user',expiresAt:Date.now()+60000,marketplace:{kind:'update',targets:[{mlb:'MLB1',body:{price:129.9}}]}};(service as any).pending.set(old.id,old);(marketplace as any).prepareNamedUpdate=jest.fn().mockResolvedValue({kind:'update',targets:[{mlb:'MLB1',body:{price:129.9},removeAutomation:{mlb:'MLB1',ruleId:'new-rule'},preview:{mlb:'MLB1',title:'Polo',account:'Mercado Livre',fields:[],notes:[]}}]});const confirm=jest.spyOn(service,'confirm');const result=await (service as any).executeBatchStage(row,{stage:'price',status:'READY',card:{id:old.id}},'bling-mottum','user');expect(result.reviewRequired).toBe(true);expect(result.card.confirmationLabel).toBe('Desativar automatização e aplicar preço');expect(confirm).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();});
  it('refreshes NCM suggestions on the existing fiscal card while preserving other edits and requiring review',async()=>{const {service,marketplace}=setup();const oldRow={mlb:'MLB1',sku:'44866.13',title:'Polo',values:{ncm:'61051000',cest:'edited',measurement_unit:'Un'},sources:{cest:'Revisado'},warnings:[]};const old={id:'old',label:'Fiscal',kind:'marketplace',accountId:'bling-mottum',userId:'user',expiresAt:Date.now()+60000,fiscal:{reference:'MLB1',rows:[oldRow],regime:'simples',approved:true}};(service as any).pending.set('old',old);(service as any).fiscal={prepare:jest.fn().mockResolvedValue({reference:'MLB1',rows:[{...oldRow,values:{ncm:'61052000',cest:'bling'},sources:{ncm:'Sugestão'},warnings:['Analisado']}],regime:'',approved:false}),preview:jest.fn().mockReturnValue([])};const result=await service.analyzeFiscalNcm('old','bling-mottum','user');const pending=(service as any).pending.get(result.actions[0].id);expect(pending.fiscal.rows[0].values).toEqual({ncm:'61052000',cest:'edited',measurement_unit:'UNID'});expect(pending.fiscal.approved).toBe(false);expect(result.actions[0].confirmationLabel).toBe('Revisar dados fiscais');expect(marketplace.execute).not.toHaveBeenCalled();await expect(service.analyzeFiscalNcm(result.actions[0].id,'bling-mottum','other-user')).rejects.toThrow();});
  const message = [{ role: 'user' as const, content: 'Consulte meus produtos' }];
  const output = (items: unknown[]) => of({ data: { output: items } });
  const call = (name: string, args: unknown) => ({type:'function_call',name,arguments:JSON.stringify(args),call_id:'call1'});
  const answer = {type:'message',content:[{type:'output_text',text:'Resultado da consulta.'}]};
  function setup(configured = true, overrides: Record<string,string> = {}) {
    const config = {get:jest.fn((key:string,fallback:string) => key in overrides ? overrides[key] : key==='OPENAI_API_KEY' ? configured?'server-only-key':'' : fallback)};
    const http = {post:jest.fn()};
    const prisma = {user:{findUnique:jest.fn().mockResolvedValue({active:true,role:'ADMIN'})},marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'bling-mottum',businessKey:'mottum',sellerId:'ts_comercio'})},auditLog:{create:jest.fn().mockResolvedValue({id:'history'}),update:jest.fn().mockResolvedValue({})}};
    const products = {findAll:jest.fn().mockResolvedValue({pagination:{total:1},data:[{sku:'123',title:'Produto',variants:[],accessToken:'must-not-leak'}]})};
    const listings = {findGrouped:jest.fn()};
    const bling = {sync:jest.fn().mockResolvedValue({id:'execution'})};
    const meli = {startBackground:jest.fn()};
    const marketplace = {identify:jest.fn(async(_account:any,reference:string)=>({referencia:reference,nome:reference,mlbs:[reference]})),prepareUpdates:jest.fn(),execute:jest.fn()};
    const service = new ChatService(config as never,http as never,prisma as never,products as never,listings as never,bling as never,meli as never,marketplace as never);
    return {service,http,prisma,products,bling,meli,marketplace};
  }
  it.each(['Altere o preço de todas as variações para 229,90','Atualize o estoque para 8','Troque o título para Polo Levis','Substitua a descrição do anúncio','Adicione uma foto ao anúncio','Pause o anúncio','Corrija o SKU da variação','Troque a tabela de medidas do anúncio'])('routes the current change instead of a historical addition: %s',async(latest)=>{
    const {service,http,marketplace}=setup();
    http.post.mockReturnValue(output([answer]));
    jest.spyOn(service as any,'executeTool').mockImplementation(async (...args:any[])=>{const state=args[5];state.familyReference='MLB1';state.catalogRows=[{sku:'1',jaExisteNoPai:true,ofertaPublicada:true,ofertaAtiva:true}];return {};});
    const old='Adicione todas as outras variações de cores conforme a Bling';

    const result=await service.reply([{role:'user',content:latest}],'bling-mottum','user',{scope:{mode:'listing',reference:'MLB1'},earlierRequests:old,userRequests:old+'\n\n'+latest});
    if(!latest.includes('preço'))expect(http.post).toHaveBeenCalled();expect(result.message).not.toContain('Não há novas variações');expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it.each(['preciso corrigir o SKU deste produto, o SKU correto é 44866','para todas as variações'])('uses the base SKU from this conversation for a real correction preview: %s',async latest=>{
    const {service,http,marketplace}=setup();
    const rows=[{sku:'44866.1',cor:'Marrom',tamanho:'P',jaExisteNoPai:true}];
    const preparation=jest.fn().mockResolvedValue({kind:'update',targets:[{mlb:'MLB1',body:{attributes:[{id:'SELLER_SKU',value_name:'44866.1'}]},preview:{mlb:'MLB1',title:'Polo',account:'Motum',fields:[{field:'SKU',before:'errado',after:'44866.1'}],notes:[]}}]});
    (marketplace as any).prepareCatalogSkuCorrection=preparation;
    jest.spyOn(service as any,'executeTool').mockImplementation(async(...args:any[])=>{expect(args[5].baseSku).toBe('44866');args[5].familyReference='MLB1';args[5].catalogRows=rows;return {};});
    const earlier='Adicione as variações ausentes da Bling.\n\nO SKU correto é 44866';
    const result=await service.reply([{role:'user',content:latest}],'bling-mottum','user',{scope:{mode:'listing',reference:'MLB1'},earlierRequests:earlier,userRequests:earlier+'\n\n'+latest});
    expect(preparation).toHaveBeenCalledWith(expect.anything(),'user','MLB1',rows);expect(result.actions).toHaveLength(1);expect(http.post).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('offers SKU correction when Bling matching fails without sending any changes',async()=>{
    const {service,marketplace}=setup();jest.spyOn(service as any,'executeTool').mockRejectedValue(new BadRequestException('Não encontrei o produto Bling pelos SKUs do anúncio.'));
    const content='Adicione as variações ausentes da Bling';
    const result=await service.reply([{role:'user',content}],'bling-mottum','user',{scope:{mode:'listing',reference:'MLB1'},earlierRequests:'',userRequests:content});
    expect(result.message).toContain('Deseja revisar e corrigir os SKUs');expect(result.message).toContain('SKU pai/base');expect(result.actions).toHaveLength(0);expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it.each(['sim','não'])('handles the answer to the SKU correction offer without repeating the failed query: %s',async content=>{
    const {service,http,marketplace}=setup();const execute=jest.spyOn(service as any,'executeTool');
    const previous={role:'assistant' as const,content:'Deseja revisar e corrigir os SKUs que podem estar incorretos?'};
    const result=await service.reply([previous,{role:'user',content}],'bling-mottum','user',{earlierRequests:'Adicione todas as variações da Bling',userRequests:'Adicione todas as variações da Bling\n\n'+content});
    expect(result.message).toContain(content==='sim'?'Informe o SKU pai/base':'cancelada');expect(execute).not.toHaveBeenCalled();expect(http.post).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('stops after a unavailable read without invented counts or repeated tool calls',async()=>{
    const {service,http,marketplace}=setup();http.post.mockReturnValue(output([call('consultar_anuncio_ml',{mlb:'MLB1'})]));const execute=jest.spyOn(service as any,'executeTool').mockRejectedValue(new ServiceUnavailableException('O Mercado Livre não respondeu à consulta dentro do prazo.'));
    const result=await service.reply([{role:'user',content:'Consulte o anúncio MLB1'}],'bling-mottum','user');
    expect(result.message).toContain('Nenhuma alteração foi enviada');expect(result.message).not.toContain('três');expect(execute).toHaveBeenCalledTimes(1);expect(http.post).toHaveBeenCalledTimes(1);expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('consults actual fiscal sources instead of answering from model memory',async()=>{
    const {service,http,marketplace}=setup();const prepare=jest.fn().mockResolvedValue({reference:'MLB1',rows:[],regime:'',approved:false});(service as any).fiscal={prepare,preview:jest.fn().mockReturnValue([])};
    const request='consulte os dados fiscais deste anúncio';
    const result=await service.reply([{role:'user',content:request}],'bling-mottum','user',{scope:{mode:'listing',reference:'MLB1'},earlierRequests:'',userRequests:request});
    expect(prepare).toHaveBeenCalledWith(expect.anything(),'MLB1',expect.any(Function));expect(result.actions[0].fiscal).toBe(true);expect(result.actions[0].confirmationLabel).toBe('Revisar dados fiscais');expect(http.post).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('keeps technical answers in the same listing fiscal flow and asks missing questions',async()=>{const {service,http,marketplace}=setup();const prepare=jest.fn().mockResolvedValue({reference:'MLB1',rows:[{warnings:['Para sugerir o NCM, informe: Qual a composição?']}],regime:'',approved:false});(service as any).fiscal={prepare,preview:jest.fn().mockReturnValue([])};const request='O tecido é de malha';const result=await service.reply([{role:'user',content:request}],'bling-mottum','user',{scope:{mode:'listing',reference:'MLB1'},earlierRequests:'Revise os dados fiscais e sugira NCM',userRequests:request});expect(prepare).toHaveBeenCalledWith(expect.anything(),'MLB1',expect.any(Function));expect(result.message).toContain('Qual a composição?');expect(result.actions[0].fiscal).toBe(true);expect(http.post).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();});
  it.each(['vamos alterar o preço deste produto para 78,50','Altere o preço deste anúncio para R$ 78,50. Prepare somente a prévia da alteração de preço.','Use o preço de R$ 78,50 para as variações. Continue preparando a prévia das cores e tamanhos solicitados.'])('prepares the real price change despite old variation context: %s',async content=>{
    const {service,http,marketplace}=setup();(marketplace as any).prepareNamedUpdate=jest.fn().mockResolvedValue({kind:'update',targets:[{mlb:'MLB1',body:{price:78.5},preview:{mlb:'MLB1',title:'Polo Marrom',account:'Motum',fields:[{field:'Preço',before:'R$ 90,00',after:'R$ 78,50'}],notes:[]}}]});
    const old='Adicione as cores ausentes da Bling';const previous='vamos alterar o preço deste produto para 78,50';
    const result=await service.reply([{role:'user',content:previous},{role:'assistant',content:'Qual preço?'},{role:'user',content}],'bling-mottum','user',{scope:{mode:'listing',reference:'MLB1'},earlierRequests:old,userRequests:old+'\n\n'+previous+'\n\n'+content});
    expect((marketplace as any).prepareNamedUpdate).toHaveBeenCalledWith(expect.anything(),'user',{anuncio:'MLB1',escopo:'pai',variacao:null,preco:78.5});expect(result.actions).toHaveLength(1);expect(result.actions[0].preview?.[0].fields[0].after).toBe('R$ 78,50');expect(http.post).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('rejects fabricated price-ready messages without a confirmation card',async()=>{const {service,http}=setup();http.post.mockReturnValue(output([{type:'message',content:[{type:'output_text',text:'A alteração de preço para 78,50 está preparada. Clique no botão Confirmar para aplicar.'}]}]));const result=await service.reply([{role:'user',content:'Quero revisar valores'}],'bling-mottum','user');expect(result.actions).toHaveLength(0);expect(result.message).toContain('Não foi gerada uma prévia confirmável');});
  it('consults an imported NCM code without needing listing context or external marketplace calls',async()=>{const {service,prisma,http,marketplace}=setup();(prisma as any).ncmEntry={findMany:jest.fn().mockResolvedValue([{code:'61051000',formattedCode:'6105.10.00',description:'De algodão',fullDescription:'Camisas de malha > De algodão',source:'Tabela_NCM_Vigente_20261014.xlsx'}]),count:jest.fn().mockResolvedValue(1)};const result=await service.reply([{role:'user',content:'Consulte o NCM 6105.10.00'}],'bling-mottum','user');expect(result.message).toContain('Camisas de malha');expect(result.message).toContain('Tabela_NCM');expect(result.actions).toHaveLength(0);expect(http.post).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();});
  it('never represents an AI text summary as a real confirmation preview',async()=>{
    const {service,http,marketplace}=setup();
    http.post.mockReturnValue(output([{type:'message',content:[{type:'output_text',text:'Prévia preparada. Preço alterado para 229,90. Confirme para aplicar.'}]}]));
    const response=await service.reply([{role:'user',content:'Ajuste o preço deste produto'}],'bling-mottum','user');
    expect(response.actions).toHaveLength(0);expect(response.message).toContain('Não foi gerada uma prévia confirmável');expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('recovers an old unconfirmed preview with its original SKUs, price and guide without publishing',async()=>{
    const {service,prisma,marketplace}=setup();(prisma.auditLog as any).findFirst=jest.fn().mockResolvedValue(null);
    const execute=jest.spyOn(service as any,'executeTool').mockImplementation(async(...args:any[])=>{expect(args[1]).toEqual({anuncio:'MLB1',variacoes:[{sku:'59666.9',fotos:null}]});expect(args[5]).toEqual(expect.objectContaining({chosenPrice:160.98,sizeChartId:'8462979'}));args[4].push({id:'new',label:'Publicar'});});
    const card:any={id:'old',label:'Publicar',modelMlb:'MLB1',preview:[{fields:[{field:'Tamanho P',after:'SKU 59666.9 · preço R$ 160,98 · estoque Bling ao vivo'},{field:'Tabela de medidas',after:'Guia · ID 8462979'}]}]};
    expect((await service.refreshSavedCard(card,'bling-mottum','user')).actions).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);expect(marketplace.execute).not.toHaveBeenCalled();
    (prisma.auditLog as any).findFirst.mockResolvedValue({after:{status:'UNVERIFIED'}});
    await expect(service.refreshSavedCard(card,'bling-mottum','user')).rejects.toThrow('já foi confirmada');
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('confirms a durably saved proposal after losing memory and waiting longer than ten minutes',async()=>{
    const {service,marketplace}=setup();let saved:any;
    (service as any).pendingStore={save:jest.fn(async(action:any)=>{saved=structuredClone(action);}),load:jest.fn(async()=>saved),claim:jest.fn(async()=>{saved=undefined;})};
    marketplace.execute.mockResolvedValue({success:true,message:'Conferido'});
    const cards:any[]=[];const plan={kind:'update',targets:[{mlb:'MLB1',body:{price:229.9},preview:{mlb:'MLB1',title:'Produto',account:'Loja',fields:[],notes:[]}}]};
    await (service as any).propose({kind:'marketplace',marketplace:plan,label:'Alterar preço',userId:'user',accountId:'bling-mottum'},cards);
    (service as any).pending.clear();const now=jest.spyOn(Date,'now').mockReturnValue(Date.now()+24*60*60*1000);
    try{expect((await service.confirm(cards[0].id,'bling-mottum','user')).success).toBe(true);await expect(service.confirm(cards[0].id,'bling-mottum','user')).rejects.toThrow('indisponível');}finally{now.mockRestore();}
    expect(marketplace.execute).toHaveBeenCalledTimes(1);
  });
  it.each(['agora altere o preço deste anúncio para 299,90','mude o preço do anúncio para R$ 299,90'])('produces a real parent price preview instead of a model promise: %s',async(content)=>{
    const {service,http,marketplace}=setup();
    const plan={kind:'update',targets:[{mlb:'MLB4300437601',body:{price:299.9},preview:{mlb:'MLB4300437601',title:'Camiseta',account:'Loja',fields:[{field:'Preço',before:'160,98',after:'299,90'}],notes:['Todas as variações']}}]};
    (marketplace as any).prepareNamedUpdate=jest.fn().mockResolvedValue(plan);
    const result=await service.reply([{role:'user',content}],'bling-mottum','user',{scope:{mode:'listing',reference:'MLB4300437601'},earlierRequests:'',userRequests:content});
    expect((marketplace as any).prepareNamedUpdate).toHaveBeenCalledWith(expect.anything(),'user',{anuncio:'MLB4300437601',escopo:'pai',variacao:null,preco:299.9});
    expect(result.actions).toHaveLength(1);expect(result.actions[0].preview?.[0].fields[0].after).toBe('299,90');expect(http.post).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();
    const followup=await service.reply([{role:'user',content:'confirmo'}],'bling-mottum','user',{earlierRequests:'',userRequests:content+'\n\nconfirmo',decisionMessages:[{role:'assistant',content:result.message,actions:result.actions} as any,{role:'user',content:'confirmo'}]});
    expect(followup.actions[0].id).toBe(result.actions[0].id);expect(followup.message).toContain('ainda não foi executada');expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('does not invent execution from a typed confirmation without an action',async()=>{
    const {service,http,marketplace}=setup();const result=await service.reply([{role:'user',content:'confirmo'}],'bling-mottum','user');
    expect(result.message).toContain('Nenhuma alteração foi executada');expect(http.post).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('requires an explicit automation-removal button in the fixed-price preview without executing it',async()=>{
    const {service,marketplace}=setup();const cards:any[]=[];
    const plan={kind:'update',targets:[{mlb:'MLB1',body:{price:299.9},removeAutomation:{mlb:'MLB1',ruleId:'INT',minPrice:100,maxPrice:400},preview:{mlb:'MLB1',title:'Produto',account:'Loja',fields:[{field:'Automatização de preços',before:'Ativa',after:'Desativar'}],notes:[]}}]};
    await (service as any).propose({kind:'marketplace',marketplace:plan,label:'Preço fixo',userId:'user',accountId:'bling-mottum'},cards);
    expect(cards[0].confirmationLabel).toBe('Desativar automatização e aplicar preço');expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('revises a preview with every size of the requested color without publishing and invalidates the old confirmation',async()=>{
    const {service,marketplace}=setup();const publications={enqueue:jest.fn()};(service as any).publications=publications;
    const cards:any[]=[];
    (service as any).propose({kind:'marketplace',publication:{modelMlb:'MLB1',price:199.99,rows:[{sku:'old',color:'Branco',size:'P'}]},label:'Cores',userId:'user',accountId:'bling-mottum'},cards);
    const execute=jest.spyOn(service as any,'executeTool').mockImplementation(async (...args:any[])=>{
      if(args[0]==='consultar_variacoes_do_anuncio')args[5].catalogRows=['P','M','G','GG','XXG'].map(size=>({sku:`amarelo-${size}`,cor:'Amarelo',jaExisteNoPai:false}));
      else (service as any).propose({kind:'marketplace',publication:{modelMlb:'MLB1',price:args[5].chosenPrice,rows:args[1].variacoes.map((row:any)=>({...row,color:'Amarelo',size:'P'}))},label:'Atualizada',userId:'user',accountId:'bling-mottum'},args[4]);
      return {};
    });
    const result=await service.revise(cards[0].id,'bling-mottum','user','Amarelo');
    expect(execute.mock.calls[1][1]).toEqual({anuncio:'MLB1',variacoes:['old','amarelo-P','amarelo-M','amarelo-G','amarelo-GG','amarelo-XXG'].map(sku=>({sku,fotos:null}))});
    expect(result.actions).toHaveLength(1);expect(publications.enqueue).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();
    await expect(service.confirm(cards[0].id,'bling-mottum','user')).rejects.toThrow('Ação expirada ou indisponível');
  });

  it('replaces a pending publication with the selected chart while retaining its SKUs and price, without publishing',async()=>{
    const {service,marketplace}=setup();const publications={enqueue:jest.fn()};(service as any).publications=publications;
    const original={familyId:'123',modelMlb:'MLB1',price:249.9,sizeChart:{id:'1',name:'Guia antigo',rows:{g:'1:g'}},rows:[{sku:'sku1',color:'Branco',size:'G'}]};const cards:any[]=[];
    (service as any).propose({kind:'marketplace',publication:original,label:'Publicar Branco',userId:'user',accountId:'bling-mottum'},cards);
    const execute=jest.spyOn(service as any,'executeTool').mockImplementation(async(...args:any[])=>{expect(args[5].chosenPrice).toBe(249.9);expect(args[5].sizeChartId).toBe('2');(service as any).propose({kind:'marketplace',publication:{...original,sizeChart:{id:'2',name:'Polo Levis',rows:{g:'2:g'}}},label:'Publicar Branco',userId:'user',accountId:'bling-mottum'},args[4]);return {};});
    const result=await service.selectSizeChart(cards[0].id,'bling-mottum','user','2');expect(execute.mock.calls[0][1]).toEqual({anuncio:'MLB1',variacoes:[{sku:'sku1',fotos:null}]});expect(result.actions[0].preview?.[0].fields.find(field=>field.field==='Tabela de medidas')?.after).toBe('Polo Levis · ID 2');
    expect(publications.enqueue).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();await expect(service.confirm(cards[0].id,'bling-mottum','user')).rejects.toThrow('Ação expirada');
  });
  it('preserves the original pending action when choosing the same chart reuses the same proposal ID',async()=>{
    const {service}=setup();const original={familyId:'123',modelMlb:'MLB1',price:249.9,sizeChart:{id:'1',rows:{g:'1:g'}},rows:[{sku:'sku1',color:'Branco',size:'G'}]};const intent={kind:'marketplace',publication:original,label:'Publicar Branco',userId:'user',accountId:'bling-mottum'};const cards:any[]=[];(service as any).propose(intent,cards);
    jest.spyOn(service as any,'executeTool').mockImplementation(async(...args:any[])=>{(service as any).propose(intent,args[4]);return {};});const result=await service.selectSizeChart(cards[0].id,'bling-mottum','user','1');expect(result.actions[0].id).toBe(cards[0].id);expect((service as any).pending.has(cards[0].id)).toBe(true);
  });

  it('one confirmation starts the complete publication job without calling variant-only execution',async()=>{
    const {service,marketplace}=setup();const publications={enqueue:jest.fn().mockResolvedValue({jobId:'publication-job'})};(service as any).publications=publications;
    const publication={familyId:'123',price:249.9,modelMlb:'MLB1',rows:[{sku:'1',color:'Amarelo',size:'G'}]};const cards:any[]=[];
    (service as any).propose({kind:'marketplace',publication,label:'Publicar cor Amarelo',userId:'user',accountId:'bling-mottum'},cards);
    expect(cards[0].confirmationLabel).toBe('Confirmar e publicar');
    const result=await service.confirm(cards[0].id,'bling-mottum','user');
    expect(result.publicationJobId).toBe('publication-job');expect(result.status).toBe('STARTED');
    expect(publications.enqueue).toHaveBeenCalledWith(publication,'user');expect(marketplace.execute).not.toHaveBeenCalled();
    await expect(service.confirm(cards[0].id,'bling-mottum','user')).rejects.toThrow('Ação expirada ou indisponível');expect(publications.enqueue).toHaveBeenCalledTimes(1);
  });
  it.each([{kind:'create',targets:[]}])('routes publication away from generic saved creation proposals ($kind)',async(plan)=>{
    const {service,marketplace}=setup();
    await expect((service as any).runConfirmed({kind:'marketplace',marketplace:plan},{id:'bling-mottum',businessKey:'mottum'},'user')).rejects.toThrow('Confirmar e publicar');
    expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('requires server configuration and rejects invalid account selection', async () => {
    const missing=setup(false);
    await expect(missing.service.reply(message,'bling-mottum','user')).rejects.toThrow('Configure');
    expect(missing.http.post).not.toHaveBeenCalled();
    const invalid=setup();invalid.prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
    await expect(invalid.service.reply(message,'foreign','user')).rejects.toThrow('Conta selecionada inválida');
  });
  it('uses selected-account data and sends only projected results to the model', async () => {
    const {service,http,products}=setup();
    http.post.mockReturnValueOnce(output([call('consultar_produtos',{busca:'123',marketplaceAccountId:'other'})])).mockReturnValueOnce(output([answer]));
    const response=await service.reply(message,'bling-mottum','user');
    expect(products.findAll).toHaveBeenCalledWith(expect.objectContaining({marketplaceAccountId:'bling-mottum',search:'123'}));
    expect(response.message).toBe('Resultado da consulta.');
    expect(JSON.stringify(http.post.mock.calls[1][1])).not.toContain('must-not-leak');
    expect(JSON.stringify(response)).not.toContain('server-only-key');
    expect(http.post.mock.calls[0][1].store).toBe(false);
  });
  it('prepares actions without executing and binds confirmation to user and account', async () => {
    const {service,http,bling}=setup();
    http.post.mockReturnValueOnce(output([call('preparar_sincronizacao',{origem:'BLING'})])).mockReturnValueOnce(output([answer]));
    const result=await service.reply(message,'bling-mottum','user');
    expect(bling.sync).not.toHaveBeenCalled();
    const id=result.actions[0].id;
    await expect(service.confirm(id,'bling-mottum','other-user')).rejects.toThrow('indisponível');
    await expect(service.confirm(id,'other-account','user')).rejects.toThrow('indisponível');
    const confirmed=await service.confirm(id,'bling-mottum','user');
    expect(confirmed.executionId).toBe('execution');
    expect(bling.sync).toHaveBeenCalledWith(undefined,'bling-mottum');
    await expect(service.confirm(id,'bling-mottum','user')).rejects.toThrow('indisponível');
    expect(bling.sync).toHaveBeenCalledTimes(1);
  });
  it('rejects unsupported tools and never executes arbitrary API calls', async () => {
    const {service,http,bling,meli}=setup();
    http.post.mockReturnValueOnce(output([call('alterar_preco',{url:'https://example.test'})])).mockReturnValueOnce(output([answer]));
    const result=await service.reply(message,'bling-mottum','user');
    expect(result.operations).toEqual([expect.objectContaining({name:'alterar_preco',success:false})]);
    expect(bling.sync).not.toHaveBeenCalled();expect(meli.startBackground).not.toHaveBeenCalled();
  });
  it('keeps adding variants separate from publishing listings, even if the model chooses the wrong tool',async()=>{
    const {service,http,marketplace}=setup();
    (marketplace as any).prepareCreate=jest.fn();
    (marketplace as any).prepareFamilyVariants=jest.fn().mockResolvedValue({kind:'family_variants',targets:[{preview:{mlb:'Família 456',title:'Polo',account:'Motum',fields:[],notes:[]}}]});
    http.post.mockReturnValueOnce(output([call('preparar_publicacao_ml',{modelo_mlb:'MLB1'})])).mockReturnValueOnce(output([call('preparar_variantes_da_familia_ml',{anuncio:'Polo',variacoes:[{sku:'54446.22',fotos:null}]})])).mockReturnValueOnce(output([answer]));
    const reply=await service.reply([{role:'user',content:'Adicione somente novas variações à Polo, sem publicar anúncios.'}],'bling-mottum','user');
    expect((marketplace as any).prepareCreate).not.toHaveBeenCalled();
    expect(reply.operations[0].success).toBe(false);
    expect(reply.actions[0].label).toContain('família existente');
    expect(marketplace.execute).not.toHaveBeenCalled();
  });

  it('recovers the parent, SKUs and stock automatically and asks only about different existing prices', async () => {
    const {service,http,prisma,marketplace}=setup();
    (marketplace as any).recall=jest.fn().mockResolvedValue({referencia:'parent',nome:'Polo Azul Royal'});
    (marketplace as any).familyItems=jest.fn().mockResolvedValue({referencia:'parent',nome:'Polo Azul Royal',precisaEscolherReferenciaPreco:true,
      anuncios:[{mlb:'MLB1',preco:247.68,variacoes:[{sku:'54446.16'}]},{mlb:'MLB2',preco:249.99,variacoes:[{sku:'54446.17'}]}]});
    (prisma as any).product={findMany:jest.fn().mockResolvedValue([{sku:'54446',title:'Polo',variants:[{sku:'54446.22',color:'Cinza Claro',size:'GG',stock:26}]}])};
    (prisma as any).productVariant={findMany:jest.fn().mockResolvedValue([])};
    (prisma.marketplaceAccount as any).findMany=jest.fn().mockResolvedValue([]);
    const messages=[{role:'user' as const,content:'Polo Azul Royal. Adicione outras variações conforme a Bling.'},{role:'user' as const,content:'Publique as ofertas com o preço igual ao da variação existente'}];
    const reply=await service.reply(messages,'bling-mottum','user',{earlierRequests:'',userRequests:messages.map(m=>m.content).join('\n')});
    expect(http.post).not.toHaveBeenCalled();
    expect(reply.message).toContain('247,68');expect(reply.message).toContain('249,99');
    expect(reply.message).not.toMatch(/nome exato|SKU exato|fornecer/);
    expect(reply.toolContext[0].output).toContain('54446.22');
    expect(reply.toolContext[0].output).toContain('quantidadePublicavel');
    expect((prisma as any).product.findMany.mock.calls[0][0].where.blingAccountId).toBe('bling-mottum');
    expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it.each(['Suba as outras cores deste produto com todos os tamanhos','Complete a grade do anúncio conforme a Bling','Cadastre as variantes disponíveis no catálogo','Polo Preta. Adicionado as outras variações de cores com os tamanhos conforme temos na Bling','camiseta Levis Original Rosa Camisa América Originals. Verifique se os SKUs da Bling estão batendo com os do anúncio. Também adicione as cores de variações que faltam ser adicionadas que estão na Bling e não no Mercado Livre','Inclua no anúncio os tamanhos ausentes do catálogo Bling','Acrescente as cores que temos na Bling mas não no anúncio'])('prepares the whole missing grade without AI-selected subsets: %s',async(content)=>{
    const {service,http,prisma,marketplace,bling}=setup();
    const rows=['Preto','Amarelo','Branco','CINZA CLARO','Azul Royal'].flatMap(color=>['P','M','G','GG','XXG'].map(size=>({sku:color+size,color,size,stock:0})));
    (bling as any).refreshCatalogForSkus=jest.fn().mockResolvedValue(undefined);
    (marketplace as any).recall=jest.fn().mockResolvedValue({referencia:'parent',nome:'Polo Preta'});
    (marketplace as any).familyItems=jest.fn().mockResolvedValue({referencia:'parent',nome:'Polo Preta',precoUnico:199.99,anuncios:[{mlb:'MLB1',modelo:'TRADICIONAL',status:'active',estoque:5,preco:199.99,variacoes:rows.filter(row=>row.color==='Preto').map(row=>({sku:row.sku}))}]});
    (marketplace as any).prepareFamilyVariants=jest.fn().mockResolvedValue({kind:'update',targets:[{body:{variations:rows.filter(row=>row.color!=='Preto').map(row=>({attributes:[{id:'SELLER_SKU',value_name:row.sku}],attribute_combinations:[{id:'COLOR',value_name:row.color},{id:'SIZE',value_name:row.size}],price:199.99,available_quantity:0}))},preview:{mlb:'MLB1',title:'Polo Preta',account:'Motum',fields:[],notes:[]}}]});
    (prisma as any).product={findMany:jest.fn().mockResolvedValue([{sku:'54446',title:'Polo',variants:rows}])};(prisma as any).productVariant={findMany:jest.fn().mockResolvedValue([])};(prisma.marketplaceAccount as any).findMany=jest.fn().mockResolvedValue([]);

    const result=await service.reply([{role:'user',content}],'bling-mottum','user',{earlierRequests:'',userRequests:content});
    expect((bling as any).refreshCatalogForSkus).toHaveBeenCalledWith('bling-mottum',rows.filter(row=>row.color==='Preto').map(row=>row.sku),{baseSku:undefined,mlbs:['MLB1'],title:'Polo Preta'});
    expect((marketplace as any).prepareFamilyVariants.mock.calls[0][2].variacoes).toHaveLength(20);
    const followup='Use a tabela de medidas CAMISETAS LEVIS FEM (ID 4923717). Continue preparando a prévia das variações solicitadas, preservando o preço escolhido.';
    const resumed=await service.reply([{role:'user',content:followup}],'bling-mottum','user',{earlierRequests:content,userRequests:content+'\n\n'+followup,sizeChartId:'4923717'});
    expect(resumed.actions).toHaveLength(1);
    expect((marketplace as any).prepareFamilyVariants.mock.calls[1][2].size_chart_id).toBe('4923717');
    expect((marketplace as any).prepareFamilyVariants.mock.calls[1][2].variacoes).toHaveLength(20);
    expect(result.actions[0].preview).toHaveLength(4);expect(result.actions[0].preview?.find(preview=>preview.title.includes('Azul Royal'))?.fields).toHaveLength(5);
    expect(result.actions[0].preview?.some(preview=>preview.title.includes('Cinza Claro'))).toBe(true);
    expect(http.post).not.toHaveBeenCalled();expect(marketplace.execute).not.toHaveBeenCalled();
  });

  it('prepares all authoritative missing rows when the model stops after consulting',async()=>{
    const {service,http,prisma,marketplace}=setup();
    const publications={latestForModels:jest.fn().mockResolvedValue(null),prepare:jest.fn().mockResolvedValue({familyId:'456',price:249.9,modelMlb:'MLB1',rows:[{sku:'54446.2',color:'Amarelo',size:'GG'},{sku:'54446.22',color:'CINZA CLARO',size:'GG'}]})};(service as any).publications=publications;
    (marketplace as any).recall=jest.fn().mockResolvedValue({referencia:'parent',nome:'Polo'});
    (marketplace as any).familyItems=jest.fn().mockResolvedValue({referencia:'parent',nome:'Polo',precoUnico:249.9,precisaEscolherReferenciaPreco:false,anuncios:[{mlb:'MLB1',modelo:'USER_PRODUCTS',status:'active',estoque:8,preco:249.9,variacoes:[{sku:'54446.17'}]}]});
    (marketplace as any).prepareFamilyVariants=jest.fn().mockResolvedValue({kind:'family_variants',targets:[{preview:{mlb:'Família 456',title:'Polo',account:'Motum',fields:[],notes:[]}}]});
    (prisma as any).product={findMany:jest.fn().mockResolvedValue([{sku:'54446',title:'Polo',variants:[{sku:'54446.17',color:'Azul Royal',size:'GG',stock:8},{sku:'54446.2',color:'Amarelo',size:'GG',stock:0},{sku:'54446.22',color:'CINZA CLARO',size:'GG',stock:26}]}])};
    (prisma as any).productVariant={findMany:jest.fn().mockResolvedValue([])};
    (prisma.marketplaceAccount as any).findMany=jest.fn().mockResolvedValue([]);
    http.post.mockReturnValue(output([answer]));
    const latest={role:'user' as const,content:'Polo. Adicione todas as variações de cores conforme a Bling.'};
    const result=await service.reply([latest],'bling-mottum','user',{earlierRequests:'',userRequests:latest.content});
    expect(publications.prepare).toHaveBeenCalledWith(expect.objectContaining({id:'bling-mottum'}),'user',{anuncio:'MLB1',preco:249.9,skus:['54446.2','54446.22'],fotos_modelo_confirmadas:false,publicar_com_saldo:true});
    expect((marketplace as any).prepareFamilyVariants).not.toHaveBeenCalled();
    expect(result.actions).toHaveLength(1);
    expect(result.message).toContain('Prévia preparada');
    expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('prepares actual color cards after a price-only follow-up instead of an unexecuted text promise',async()=>{
    const {service,http,prisma,marketplace}=setup();const publication={familyId:'456',price:249.9,modelMlb:'MLB1',rows:[{sku:'54446.2',color:'Amarelo',size:'GG'}]};
    const publications={latestForModels:jest.fn().mockResolvedValue(null),prepare:jest.fn().mockResolvedValue(publication)};(service as any).publications=publications;
    (marketplace as any).recall=jest.fn().mockResolvedValue({referencia:'parent',nome:'Polo'});
    (marketplace as any).familyItems=jest.fn().mockResolvedValue({referencia:'parent',nome:'Polo',precoUnico:249.9,precisaEscolherReferenciaPreco:false,anuncios:[{mlb:'MLB1',modelo:'USER_PRODUCTS',status:'active',estoque:8,preco:249.9,variacoes:[{sku:'54446.17'}]}]});
    (prisma as any).product={findMany:jest.fn().mockResolvedValue([{sku:'54446',title:'Polo',variants:[{sku:'54446.17',color:'Azul Royal',size:'GG',stock:8},{sku:'54446.2',color:'Amarelo',size:'GG',stock:0}]}])};
    (prisma as any).productVariant={findMany:jest.fn().mockResolvedValue([])};(prisma.marketplaceAccount as any).findMany=jest.fn().mockResolvedValue([]);
    http.post.mockReturnValue(output([{type:'message',content:[{type:'output_text',text:'Vou preparar a lista do anúncio tradicional.'}]}]));
    const original={role:'user' as const,content:'Polo. Adicione todas as variações de cores conforme a Bling.'};const latest={role:'user' as const,content:'249,90'};
    const result=await service.reply([latest],'bling-mottum','user',{earlierRequests:original.content,userRequests:original.content+'\n\n'+latest.content,decisionMessages:[original,{role:'assistant',content:'Qual preço?'},latest]});
    expect(result.actions).toHaveLength(1);expect(result.actions[0].confirmationLabel).toBe('Confirmar e publicar');expect(result.actions[0].preview?.[0].title).toContain('Cor Amarelo');expect(result.message).not.toContain('tradicional');expect(marketplace.execute).not.toHaveBeenCalled();
  });

  it('restores pending proposals only for their owner and marks consumed proposals unavailable', async () => {
    const {service,http,prisma}=setup();
    (prisma.auditLog as any).findFirst=jest.fn().mockResolvedValue(null);
    http.post.mockReturnValueOnce(output([call('preparar_sincronizacao',{origem:'BLING'})])).mockReturnValueOnce(output([answer]));
    const reply=await service.reply(message,'bling-mottum','user');
    expect(await service.restoreActions(reply.actions,'bling-mottum','user')).toEqual(reply.actions);
    expect((await service.restoreActions(reply.actions,'bling-mottum','other-user'))[0]).toEqual(expect.objectContaining({state:'error'}));
    await service.cancel(reply.actions[0].id,'bling-mottum','user');
    (prisma.auditLog as any).findFirst.mockResolvedValue({after:{status:'CANCELLED',message:'Proposta cancelada'}});
    expect((await service.restoreActions(reply.actions,'bling-mottum','user'))[0]).toEqual(expect.objectContaining({state:'cancelled',result:'Proposta cancelada'}));
  });
  it('shows a marketplace preview, binds it to user and account, and executes only once on confirmation', async () => {
    const {service,http,marketplace}=setup();
    const plan={kind:'update',targets:[{body:{price:120},preview:{mlb:'MLB123',title:'Produto',account:'Loja',fields:[{field:'Preço',before:'100',after:'120'}],notes:[]}}]};
    marketplace.prepareUpdates.mockResolvedValue(plan);
    marketplace.execute.mockResolvedValue({success:true,message:'Verificado.'});
    http.post.mockReturnValueOnce(output([call('preparar_alteracoes_ml',{alteracoes:[{mlb:'MLB123',preco:120}]})])).mockReturnValueOnce(output([answer]));
    const result=await service.reply(message,'bling-mottum','user');
    expect(marketplace.execute).not.toHaveBeenCalled();
    expect(result.actions[0].preview?.[0].fields[0].after).toBe('120');
    const id=result.actions[0].id;
    await expect(service.confirm(id,'bling-mottum','other-user')).rejects.toThrow('indisponível');
    await expect(service.confirm(id,'other-account','user')).rejects.toThrow('indisponível');
    await service.confirm(id,'bling-mottum','user');
    expect(marketplace.execute).toHaveBeenCalledWith(plan,expect.objectContaining({businessKey:'mottum'}),'user');
    await expect(service.confirm(id,'bling-mottum','user')).rejects.toThrow('indisponível');
    expect(marketplace.execute).toHaveBeenCalledTimes(1);
  });
  it('cancels marketplace actions on the server and keeps revised prices in separate proposals', async () => {
    const {service,http,marketplace}=setup();
    const plan=(price:number)=>({kind:'update',targets:[{body:{price},preview:{mlb:'MLB123',title:'Produto',account:'Loja',fields:[],notes:[]}}]});
    marketplace.prepareUpdates.mockResolvedValueOnce(plan(120)).mockResolvedValueOnce(plan(130));
    http.post.mockReturnValueOnce(output([call('preparar_alteracoes_ml',{alteracoes:[{mlb:'MLB123',preco:120}]}),call('preparar_alteracoes_ml',{alteracoes:[{mlb:'MLB123',preco:130}]})])).mockReturnValueOnce(output([answer]));
    const result=await service.reply(message,'bling-mottum','user');
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].id).not.toBe(result.actions[1].id);
    await service.cancel(result.actions[0].id,'bling-mottum','user');
    await expect(service.confirm(result.actions[0].id,'bling-mottum','user')).rejects.toThrow('indisponível');
    expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('expires pending marketplace changes after ten minutes', async () => {
    const {service,http,marketplace}=setup();
    marketplace.prepareUpdates.mockResolvedValue({kind:'update',targets:[{body:{price:120},preview:{mlb:'MLB123',title:'Produto',account:'Loja',fields:[],notes:[]}}]});
    http.post.mockReturnValueOnce(output([call('preparar_alteracoes_ml',{alteracoes:[{mlb:'MLB123',preco:120}]})])).mockReturnValueOnce(output([answer]));
    const result=await service.reply(message,'bling-mottum','user');
    const realNow=Date.now();const clock=jest.spyOn(Date,'now').mockReturnValue(realNow+601000);
    try {await expect(service.confirm(result.actions[0].id,'bling-mottum','user')).rejects.toThrow('expirada');}
    finally {clock.mockRestore();}
    expect(marketplace.execute).not.toHaveBeenCalled();
  });
  it('saves the confirmed action and its verified result before returning', async () => {
    const {service,http,marketplace,prisma}=setup();
    marketplace.prepareUpdates.mockResolvedValue({kind:'update',targets:[{body:{price:120},preview:{mlb:'MLB123',title:'Produto',account:'Loja',fields:[],notes:[]}}]});
    marketplace.execute.mockResolvedValue({success:true,status:'SUCCESS',message:'Verificado.',results:[{mlb:'MLB123',success:true,message:'Verificado.'}]});
    http.post.mockReturnValueOnce(output([call('preparar_alteracoes_ml',{alteracoes:[{mlb:'MLB123',preco:120}]})])).mockReturnValueOnce(output([answer]));
    const reply=await service.reply(message,'bling-mottum','user');
    await service.confirm(reply.actions[0].id,'bling-mottum','user');
    const intent=prisma.auditLog.create.mock.calls[0][0].data;
    expect(intent.action).toBe('CHAT_ACTION');expect(intent.before.accountId).toBe('bling-mottum');expect(intent.before.kind).toBe('marketplace');expect(intent.after.status).toBe('RUNNING');
    expect(prisma.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(marketplace.execute.mock.invocationCallOrder[0]);
    expect(prisma.auditLog.update.mock.calls[0][0].data.after.status).toBe('SUCCESS');
  });
  it('does not execute if recording the confirmation intent fails', async () => {
    const {service,http,bling,prisma}=setup();
    http.post.mockReturnValueOnce(output([call('preparar_sincronizacao',{origem:'BLING'})])).mockReturnValueOnce(output([answer]));
    const reply=await service.reply(message,'bling-mottum','user');
    prisma.auditLog.create.mockRejectedValue(new Error('database unavailable'));
    await expect(service.confirm(reply.actions[0].id,'bling-mottum','user')).rejects.toThrow('database unavailable');
    expect(bling.sync).not.toHaveBeenCalled();
  });
  it('records failed execution and does not hide it as successful', async () => {
    const {service,http,bling,prisma}=setup();
    http.post.mockReturnValueOnce(output([call('preparar_sincronizacao',{origem:'BLING'})])).mockReturnValueOnce(output([answer]));
    const reply=await service.reply(message,'bling-mottum','user');
    bling.sync.mockRejectedValue(new Error('provider failure'));
    await expect(service.confirm(reply.actions[0].id,'bling-mottum','user')).rejects.toThrow('provider failure');
    expect(prisma.auditLog.update.mock.calls[0][0].data.after.status).toBe('FAILED');
    expect(JSON.stringify(prisma.auditLog.update.mock.calls[0][0])).not.toContain('provider failure');
  });
  it('records cancellation and prevents a concurrent confirmation from executing', async () => {
    const {service,http,bling,prisma}=setup();
    http.post.mockReturnValueOnce(output([call('preparar_sincronizacao',{origem:'BLING'})])).mockReturnValueOnce(output([answer]));
    const reply=await service.reply(message,'bling-mottum','user');const id=reply.actions[0].id;
    const cancelling=service.cancel(id,'bling-mottum','user');
    await expect(service.confirm(id,'bling-mottum','user')).rejects.toThrow('indisponível');await cancelling;
    expect(prisma.auditLog.create.mock.calls[0][0].data.after.status).toBe('CANCELLED');expect(bling.sync).not.toHaveBeenCalled();
  });
  it('does not expose provider credentials in failures', async () => {
    const {service,http}=setup();
    http.post.mockReturnValue(throwError(()=>({response:{status:401,data:{token:'secret'}}})));
    await expect(service.reply(message,'bling-mottum','user')).rejects.toThrow('chave da IA foi recusada');
  });
  it('runs Qwen tool calls against the selected server without an OpenAI key', async () => {
    const {service,http,products}=setup(false,{CHAT_PROVIDER:'qwen',CHAT_BASE_URL:'http://qwen-server:11434/v1',CHAT_MODEL:'qwen-test',CHAT_REASONING_EFFORT:'none'});
    http.post.mockReturnValueOnce(of({data:{choices:[{message:{content:null,tool_calls:[{id:'qwen-call',type:'function',function:{name:'consultar_produtos',arguments:'{"busca":"123"}'}}]}}]}}))
      .mockReturnValueOnce(of({data:{choices:[{message:{content:'Produto encontrado.'}}]}}));
    expect(service.status().configured).toBe(true);
    const result=await service.reply(message,'bling-mottum','user');
    expect(result.message).toBe('Produto encontrado.');
    expect(products.findAll).toHaveBeenCalledWith(expect.objectContaining({marketplaceAccountId:'bling-mottum'}));
    expect(http.post.mock.calls.every(call=>call[0]==='http://qwen-server:11434/v1/chat/completions')).toBe(true);
    expect(http.post.mock.calls[0][2].headers.Authorization).toBeUndefined();
    expect(http.post.mock.calls.every(call=>call[1].reasoning_effort==='none')).toBe(true);
    expect(http.post.mock.calls[1][1].messages).toContainEqual(expect.objectContaining({role:'tool',tool_call_id:'qwen-call'}));
  });
});
