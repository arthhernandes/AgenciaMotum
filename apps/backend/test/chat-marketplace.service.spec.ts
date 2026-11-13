import { ChatMarketplaceService } from '../src/chat/chat-marketplace.service';

describe('Confirmed Mercado Livre operations', () => {
  it('moves a legacy parent SKU to variation SKUs atomically, without changing price or stock',async()=>{
    const f=setup({attributes:[{id:'SELLER_SKU',value_name:'29941'},{id:'BRAND',value_name:'Polo Live'}],variations:[{id:10,available_quantity:3,price:100,attributes:[],attribute_combinations:[{id:'COLOR',value_name:'Cáqui'},{id:'SIZE',value_name:'P'}]}]});
    jest.spyOn(f.service,'fiscalSources').mockResolvedValue([{account:{id:'ml-account',name:'Loja',sellerId:'123'},item:f.item,token:'private-token'}] as any);
    const plan=await f.service.prepareCatalogSkuCorrection({id:'bling',businessKey:'outlet4u'},'user','MLB123456',[{sku:'54506.14',cor:'Caqui',tamanho:'P'}]);
    const body=plan.targets[0].body;
    expect(body.attributes.find((a:any)=>a.id==='SELLER_SKU').value_name).toBeNull();
    expect(body.variations[0].attributes).toContainEqual({id:'SELLER_SKU',value_name:'54506.14'});
    expect(body).not.toHaveProperty('price');expect(body.variations[0]).not.toHaveProperty('available_quantity');
    const after={...f.item,attributes:[{id:'BRAND',value_name:'Polo Live'}],variations:[{...f.item.variations[0],attributes:body.variations[0].attributes}]};
    expect((f.service as any).verified(after,body)).toBe(true);
    expect((f.service as any).verified({...after,attributes:f.item.attributes},body)).toBe(false);
  });
  it('explains and stops a SKU correction when the existing chart belongs to another domain',async()=>{
    const client:any={getSizeChart:jest.fn().mockResolvedValue({id:'1865261',domain_id:'SHIRTS'})};
    const service=new ChatMarketplaceService({} as any,{} as any,client);
    const item={id:'MLB5272773884',domain_id:'MLB-SPORT_T_SHIRTS',attributes:[{id:'SIZE_GRID_ID',value_name:'1865261'}]};
    await expect((service as any).assertSkuCorrectionChart('token',item)).rejects.toThrow('não é compatível');
    client.getSizeChart.mockResolvedValue({id:'1865261',domain_id:'SPORT_T_SHIRTS'});
    await expect((service as any).assertSkuCorrectionChart('token',item)).resolves.toBeUndefined();
  });
  const business = { id: 'bling', businessKey: 'outlet4u' };
  function setup(overrides: Record<string, any> = {}) {
    const account = { id: 'ml-account', name: 'Loja', sellerId: '123' };
    const item: any = { id: 'MLB123456', seller_id: 123, currency_id: 'BRL', price: 100, available_quantity: 8,
      status: 'active', title: 'Camiseta', category_id: 'MLB100', condition: 'new', listing_type_id: 'gold_special',
      pictures: [{ id: '1-MLB123_012026' }], attributes: [{ id: 'BRAND', value_name: 'Marca' }], variations: [],
      last_updated: '2026-10-08T10:00:00Z', ...overrides };
    const prisma = {
      productVariant: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ active: true, role: 'ADMIN' }) },
      marketplaceAccount: { findFirst: jest.fn().mockResolvedValue(account), findMany: jest.fn().mockResolvedValue([account]) },
      marketplaceListing: { findFirst: jest.fn().mockResolvedValue({ marketplaceAccount: account }), upsert: jest.fn().mockResolvedValue({ id: 'listing' }) },
      marketplaceListingVariant: { upsert: jest.fn().mockResolvedValue({}),deleteMany:jest.fn() },
      auditLog: { findMany:jest.fn().mockResolvedValue([]),create: jest.fn().mockResolvedValue({ id: 'audit' }), update: jest.fn().mockResolvedValue({}) }
    };
    const auth = { getValidAccessToken: jest.fn().mockResolvedValue('private-token') };
    const client = {
      getItem: jest.fn().mockImplementation(async () => structuredClone(item)),
      getSeller: jest.fn().mockResolvedValue({ id: 123, tags: [] }),
      getPriceAutomation: jest.fn().mockResolvedValue(null),
      getSellerPriceAutomationItems: jest.fn().mockResolvedValue([]),
      getDescription: jest.fn().mockResolvedValue({ plain_text: 'Descrição antiga' }),
      updateItem: jest.fn().mockImplementation(async (_token, _id, body) => { Object.assign(item, body); return structuredClone(item); }),
      setDescription: jest.fn().mockResolvedValue({}),
      validateItem: jest.fn().mockResolvedValue({}),
      createItem: jest.fn().mockResolvedValue({ ...item, id: 'MLB999999' })
    };
    (client as any).getItemPrices=jest.fn(async()=>({prices:[{type:'standard',amount:item.price,currency_id:item.currency_id,conditions:{context_restrictions:['channel_marketplace']}}]}));
    (client as any).updateStandardPrices=jest.fn(async(_token,_id,prices)=>{item.price=prices[0].amount;for(const variation of item.variations)variation.price=item.price;return {prices};});
    const service = new ChatMarketplaceService(prisma as never, auth as never, client as never);
    jest.spyOn(service as any,'priceReadbackDelay').mockResolvedValue(undefined);
    return { service, prisma, client, auth, account, item };
  }
  const priceChange = { mlb: 'MLB123456', preco: 120 };
  it('preserves a legacy gallery of 150 photos while changing one variation',async()=>{
    const ids=Array.from({length:150},(_,i)=>`${i+1}-MLB123_012026`);
    const variations=Array.from({length:25},(_,i)=>({id:i+1,picture_ids:ids.slice(i*6,i*6+6)}));
    const {service,client,item}=setup({pictures:ids.map(id=>({id})),variations});
    const fresh='999-MLB123_012026';
    const plan=await service.prepareUpdates(business,'user',[{mlb:item.id,fotos:[fresh,...ids.slice(6)],fotos_variacoes:[{id:'1',fotos:[fresh]}]}]);
    expect(plan.targets[0].body.pictures).toHaveLength(145);
    expect(plan.targets[0].body.variations[0]).toEqual({id:1,picture_ids:[fresh]});
    expect(plan.targets[0].body.variations.slice(1)).toEqual(variations.slice(1).map(({id})=>({id})));
    expect(client.updateItem).not.toHaveBeenCalled();
  });
  it('stages and verifies replacement photos only for selected legacy variations, preserving the other color',async()=>{
    const a='1-MLB123_012026',b='2-MLB123_012026',fresh='3-MLB123_012026';
    const {service,client,item}=setup({pictures:[{id:a},{id:b}],variations:[{id:1,price:100,available_quantity:4,picture_ids:[a]},{id:2,price:100,available_quantity:5,picture_ids:[b]}]});
    const plan=await service.prepareUpdates(business,'user',[{mlb:item.id,fotos:[fresh,b],fotos_variacoes:[{id:'1',fotos:[fresh]}]}]);
    expect(plan.targets[0].body.variations).toEqual([{id:1,picture_ids:[fresh]},{id:2}]);expect(client.updateItem).not.toHaveBeenCalled();
    client.updateItem.mockImplementation(async(_token,_id,body)=>{item.variations=item.variations.map((v:any)=>({...v,...body.variations.find((entry:any)=>entry.id===v.id)}));item.pictures=body.pictures;return structuredClone(item);});
    const result=await service.execute(plan,business,'user');expect(result.success).toBe(true);expect(item.variations[1].picture_ids).toEqual([b]);expect(item.variations[0].available_quantity).toBe(4);
  });
  it('rejects removal of another color photos and invalid legacy photo targets before writing',async()=>{
    const a='1-MLB123_012026',b='2-MLB123_012026',fresh='3-MLB123_012026';const {service,client,item}=setup({pictures:[{id:a},{id:b}],variations:[{id:1,picture_ids:[a]},{id:2,picture_ids:[b]}]});
    await expect(service.prepareUpdates(business,'user',[{mlb:item.id,fotos:[fresh],fotos_variacoes:[{id:'1',fotos:[fresh]}]}])).rejects.toThrow('Preserve');
    for(const choices of [[{id:'99',fotos:[fresh]}],[{id:'1',fotos:[fresh]},{id:'1',fotos:[fresh]}],[{id:'1',fotos:[a]}]])await expect(service.prepareUpdates(business,'user',[{mlb:item.id,fotos:[fresh,b],fotos_variacoes:choices}])).rejects.toThrow();
    expect(client.updateItem).not.toHaveBeenCalled();
  });
  it('allows a new approved price attempt when current reads confirm no automation despite historical rejection',async()=>{const {service,prisma,client}=setup();prisma.auditLog.findMany.mockResolvedValue([{after:{message:'O Mercado Livre bloqueou a edição manual do preço deste anúncio.'}}] as never);const plan=await service.prepareUpdates(business,'user',[priceChange]);expect(plan.targets[0].body.price).toBe(120);expect(plan.targets[0].removeAutomation).toBeUndefined();expect(client.getPriceAutomation).toHaveBeenCalledWith('private-token','MLB123456',true);expect(client.getSellerPriceAutomationItems).toHaveBeenCalledWith('private-token','123');expect(client.updateItem).not.toHaveBeenCalled();});
  it('reports seller listing membership without guessing a missing rule',async()=>{const {service,prisma,client}=setup();prisma.auditLog.findMany.mockResolvedValue([{after:{message:'O Mercado Livre bloqueou a edição manual do preço'}}] as never);client.getSellerPriceAutomationItems.mockResolvedValue(['MLB123456'] as never);await expect(service.prepareUpdates(business,'user',[priceChange])).rejects.toThrow('consta na lista');expect(client.updateItem).not.toHaveBeenCalled();});
  it('does not set a price when removal has not propagated and never repeats the removal request',async()=>{
    const {service,client,item}=setup({tags:['dynamic_standard_price']});
    client.getPriceAutomation.mockResolvedValue({item_id:item.id,status:'ACTIVE',item_rule:{rule_id:'INT'},min_price:80,max_price:150} as any);
    (client as any).removePriceAutomation=jest.fn().mockResolvedValue(undefined);
    const result=await service.execute(await service.prepareUpdates(business,'user',[priceChange]),business,'user');
    expect(result.status).toBe('UNVERIFIED');expect(result.message).toContain('preço não foi alterado');expect(client.updateItem).not.toHaveBeenCalled();expect((client as any).removePriceAutomation).toHaveBeenCalledTimes(1);
  });
  it('records removed automation separately when the subsequent price change fails',async()=>{
    const {service,client,item}=setup({tags:['dynamic_standard_price']});let automation:any={item_id:item.id,status:'ACTIVE',item_rule:{rule_id:'INT'},min_price:80,max_price:150};
    client.getPriceAutomation.mockImplementation(async()=>automation);
    (client as any).removePriceAutomation=jest.fn(async()=>{automation=null;item.tags=[];});
    client.updateItem.mockRejectedValue({response:{status:400,data:{error:'item.price.not_modifiable'}}});
    const result=await service.execute(await service.prepareUpdates(business,'user',[priceChange]),business,'user');
    expect(result.status).toBe('UNVERIFIED');expect(result.message).toContain('automatização foi desativada');expect(result.message).toContain('preço');expect(item.price).toBe(100);
  });
  it('does not propose removing a linked catalog rule owned by a different seller',async()=>{
    const {service,client,item}=setup({tags:['dynamic_standard_price']});
    client.getPriceAutomation.mockResolvedValue({item_id:'MLB654321',status:'ACTIVE',item_rule:{rule_id:'INT'}} as any);
    client.getItem.mockImplementation(async(_token,id)=>({...structuredClone(item),id,seller_id:id==='MLB654321'?999:123}));
    await expect(service.prepareUpdates(business,'user',[priceChange])).rejects.toThrow();expect(client.updateItem).not.toHaveBeenCalled();
  });
  it.each(['ACTIVE','PAUSED'])('previews removal of an %s automation and removes it only at confirmation before setting price',async(status)=>{
    const {service,client,item}=setup({tags:['dynamic_standard_price'],variations:[{id:1,price:100}]});
    let automation:any={item_id:item.id,status,item_rule:{rule_id:'INT_EXT'},min_price:80,max_price:150};
    client.getPriceAutomation.mockImplementation(async()=>automation);
    const remove=jest.fn(async()=>{automation=null;item.tags=[];});(client as any).removePriceAutomation=remove;
    const plan=await service.prepareUpdates(business,'user',[priceChange]);
    expect(plan.targets[0].removeAutomation).toEqual({mlb:item.id,ruleId:'INT_EXT',minPrice:80,maxPrice:150});
    expect(plan.targets[0].preview.fields).toContainEqual(expect.objectContaining({field:'Automatização de preços',after:'Desativar e definir o preço fixo informado'}));
    expect(remove).not.toHaveBeenCalled();expect(client.updateItem).not.toHaveBeenCalled();
    const result=await service.execute(plan,business,'user');expect(result.success).toBe(true);expect(result.message).toContain('Automatização desativada');
    expect(remove).toHaveBeenCalledTimes(1);expect(remove.mock.invocationCallOrder[0]).toBeLessThan(client.updateItem.mock.invocationCallOrder[0]);expect(item.price).toBe(120);
  });
  it('does not change price when removal is refused and does not repeat the DELETE',async()=>{
    const {service,client,item}=setup({tags:['dynamic_standard_price']});const automation={item_id:item.id,status:'ACTIVE',item_rule:{rule_id:'INT'},min_price:80,max_price:150};
    client.getPriceAutomation.mockResolvedValue(automation as any);
    (client as any).removePriceAutomation=jest.fn().mockRejectedValue({response:{status:412,data:{error:'automation_operation_not_allowed'}}});
    const plan=await service.prepareUpdates(business,'user',[priceChange]);const result=await service.execute(plan,business,'user');
    expect(result.status).toBe('FAILED');expect(result.message).toContain('não autorizou');expect(client.updateItem).not.toHaveBeenCalled();expect((client as any).removePriceAutomation).toHaveBeenCalledTimes(1);
  });
  it('does not remove a rule changed after the preview',async()=>{
    const {service,client,item}=setup({tags:['dynamic_standard_price']});const automation={item_id:item.id,status:'ACTIVE',item_rule:{rule_id:'INT'},min_price:80,max_price:150};
    client.getPriceAutomation.mockResolvedValue(automation as any);(client as any).removePriceAutomation=jest.fn();
    const plan=await service.prepareUpdates(business,'user',[priceChange]);automation.min_price=90;
    const result=await service.execute(plan,business,'user');expect(result.status).toBe('FAILED');expect(result.message).toContain('regra de automatização mudou');expect((client as any).removePriceAutomation).not.toHaveBeenCalled();expect(client.updateItem).not.toHaveBeenCalled();
  });
  it('refreshes the price before confirmation and edits through the available item endpoint',async()=>{
    const {service,client,item}=setup({variations:[{id:1,price:100}]});const plan=await service.prepareUpdates(business,'user',[priceChange]);
    item.price=110;item.variations[0].price=110;
    const result=await service.execute(plan,business,'user');expect(result.success).toBe(true);
    expect(client.updateItem.mock.calls[0][2].price).toBe(120);expect((client as any).updateStandardPrices).not.toHaveBeenCalled();
  });
  it('compares durable JSON values independently of database object key order',()=>{
    const {service}=setup();
    expect((service as any).sameValue([{amount:100,currency_id:'BRL',conditions:{context_restrictions:['channel_marketplace']}}],[{conditions:{context_restrictions:['channel_marketplace']},currency_id:'BRL',amount:100}])).toBe(true);
    expect((service as any).sameValue([{amount:100}],[{amount:120}])).toBe(false);
  });
  it('reports an explicit rejected price write as failed rather than partially applied',async()=>{
    const {service,client}=setup();const plan=await service.prepareUpdates(business,'user',[priceChange]);
    client.updateItem.mockRejectedValue({response:{status:400,data:{cause:[{code:'price.invalid'}]}}});
    const result=await service.execute(plan,business,'user');expect(result.status).toBe('FAILED');expect(result.message).not.toContain('parcialmente');expect(client.updateItem).toHaveBeenCalledTimes(1);
  });
  it('blocks dynamic pricing before writing even when the automation endpoint has no readable rule',async()=>{
    const {service,client}=setup({tags:['dynamic_standard_price']});
    await expect(service.prepareUpdates(business,'user',[priceChange])).rejects.toThrow('automatização');
    expect(client.updateItem).not.toHaveBeenCalled();expect((client as any).updateStandardPrices).not.toHaveBeenCalled();
  });
  it('verifies inherited attributes represented as values without inventing missing names',()=>{
    const {service}=setup();const verify=(service as any).verified.bind(service);
    const item={attributes:[{id:'BRAND',value_id:'1',value_name:"Levi's",values:[{id:'1',name:"Levi's"}]},{id:'SIZE_GRID_ID',value_name:'4665244',values:[{id:null,name:'4665244'}]}]};
    expect(verify(item,{attributes:[{id:'BRAND',values:[{id:'1',name:"Levi's"}]},{id:'SIZE_GRID_ID',value_name:'4665244'}]})).toBe(true);
    expect(verify(item,{attributes:[{id:'BRAND',values:[{id:'2',name:"Levi's"}]}]})).toBe(false);
    expect(verify(item,{attributes:[{id:'SIZE_GRID_ID',value_name:'8408345'}]})).toBe(false);
    expect(verify({attributes:[{id:'RECOMMENDED_SPORTS',value_name:'Casual,Trabalho',values:[{id:null,name:'Casual'},{id:null,name:'Trabalho'}]}]},{attributes:[{id:'RECOMMENDED_SPORTS',value_name:'Casual,Trabalho'}]})).toBe(true);
  });
  it('blocks a new publication with the wrong Bling color before provider validation', async () => {
    const {service,prisma,client} = setup({attributes:[{id:'COLOR',value_name:'Azul Royal'},{id:'SIZE',value_name:'GG'}]});
    prisma.productVariant.findUnique.mockResolvedValue({sku:'54446.22',color:'CINZA CLARO',size:'GG'} as never);
    await expect(service.prepareCreate(business,'user',{modelo_mlb:'MLB123456',titulo:'Polo',sku:'54446.22',estoque:26,preco:249.99})).rejects.toThrow('54446.22');
    expect(prisma.productVariant.findUnique).toHaveBeenCalledWith({where:{blingAccountId_sku:{blingAccountId:'bling',sku:'54446.22'}}});
    expect(client.validateItem).not.toHaveBeenCalled();
    expect(client.createItem).not.toHaveBeenCalled();
  });

  function familySetup(overrides: Record<string, any> = {}) {
    const context = setup(overrides);
    const listing = { id: 'listing', marketplaceAccountId: 'ml-account', itemId: 'MLB123456', title: 'Camiseta Cinza',
      rawData: { family_id: 'family1', family_name: 'Camiseta Cinza' }, price: 100, availableQuantity: 8, soldQuantity: 0,
      variants: (context.item.variations ?? []).map((v: any) => ({ variationId: String(v.id), sku: v.seller_custom_field, rawData: v })) };
    (context.prisma.marketplaceListing as any).findMany = jest.fn().mockResolvedValue([listing]);
    return { ...context, listing };
  }

  it('automatically chooses traditional addition from the live parent and authoritative Bling rows',async()=>{
    const {service,prisma,client}=familySetup({variations:[{id:1,available_quantity:8,seller_custom_field:'54446.17',attribute_combinations:[{id:'COLOR',value_name:'Azul Royal'},{id:'SIZE',value_name:'GG'}],picture_ids:['1-MLB123_012026']}]});
    prisma.productVariant.findUnique.mockImplementation(async (args:any) => ({id:'row',productId:'product',sku:args.where.blingAccountId_sku.sku,color:args.where.blingAccountId_sku.sku==='54446.22'?'CINZA CLARO':'Azul Royal',size:'GG',stock:-1,blingAccountId:'bling'} as never));
    (prisma.productVariant as any).findMany=jest.fn().mockResolvedValue([]);
    prisma.marketplaceAccount.findMany.mockResolvedValue([]);
    const plan=await service.prepareFamilyVariants(business,'user',{anuncio:'Camiseta Cinza',variacoes:[{sku:'54446.22',fotos:null}]});
    expect(plan.kind).toBe('update');
    expect(plan.targets[0].body.variations[0]).toEqual({id:1});
    expect(plan.targets[0].body.variations[1]).toEqual(expect.objectContaining({available_quantity:0,price:100,attribute_combinations:[{id:'COLOR',value_name:'Cinza Claro'},{id:'SIZE',value_name:'GG'}]}));
    expect(client.updateItem).not.toHaveBeenCalled();expect(client.createItem).not.toHaveBeenCalled();
  });

  it.each([true,false])('links warehouse stock and distinguishes delayed listing readback (reflected=%s)',async(reflected)=>{
    const {service,prisma,client,item}=familySetup({variations:[{id:1,available_quantity:8,seller_custom_field:'54446.17',attribute_combinations:[{id:'COLOR',value_name:'Azul Royal'},{id:'SIZE',value_name:'GG'}],picture_ids:['1-MLB123_012026']}]});
    prisma.productVariant.findUnique.mockImplementation(async (args:any)=>({id:'row',productId:'product',sku:args.where.blingAccountId_sku.sku,color:args.where.blingAccountId_sku.sku==='54446.22'?'CINZA CLARO':'Azul Royal',size:'GG',stock:26,blingAccountId:'bling'} as never));
    (prisma.productVariant as any).findMany=jest.fn().mockResolvedValue([]);prisma.marketplaceAccount.findMany.mockResolvedValue([]);
    client.getSeller.mockResolvedValue({id:123,tags:['warehouse_management']} as never);
    (client as any).getWarehouses=jest.fn().mockResolvedValue([{id:7,user_id:123,status:'active',tags:['stock_location'],network_node_id:'node'}]);
    const bling={liveStockForSku:jest.fn().mockResolvedValue({publishable:7})};(service as any).bling=bling;
    const plan=await service.prepareFamilyVariants(business,'user',{anuncio:'Camiseta Cinza',variacoes:[{sku:'54446.22',fotos:null}]});
    expect(plan.targets[0].additionWarehouse).toEqual({store_id:'7',network_node_id:'node'});expect(plan.targets[0].body.variations[1].available_quantity).toBe(0);expect(client.updateItem).not.toHaveBeenCalled();
    client.updateItem.mockImplementation(async (_token,_mlb,body)=>{item.variations=[item.variations[0],{...body.variations[1],id:2,user_product_id:'UP2'}];return structuredClone(item);});
    let stock:any=null;
    (client as any).getProductStock=jest.fn().mockImplementation(async()=>stock);
    (client as any).initializeWarehouseStock=jest.fn().mockImplementation(async (_token,_up,location)=>{stock={data:{id:'UP2',user_id:123,locations:[{type:'seller_warehouse',...location}]},version:'1'};if(reflected)item.variations[1].available_quantity=location.quantity;});
    const result=await service.execute(plan,business,'user');
    expect(result.success).toBe(reflected);if(!reflected){expect(result.message).toContain('Variações publicadas e conferidas');expect(result.message).toContain('Não é necessário publicar novamente');}expect(client.updateItem).toHaveBeenCalledTimes(1);expect((client as any).initializeWarehouseStock).toHaveBeenCalledWith('private-token','UP2',{store_id:'7',network_node_id:'node',quantity:7});
    expect(bling.liveStockForSku).toHaveBeenCalledWith('bling','54446.22');expect(item.variations[0].available_quantity).toBe(8);
  });

  it('associates the selected chart and its exact size rows with new and existing traditional variants only in the preview',async()=>{
    const {service,prisma,client}=familySetup({domain_id:'MLB-SHIRTS',variations:[{id:1,available_quantity:8,seller_custom_field:'54446.17',attributes:[{id:'SELLER_SKU',value_name:'54446.17'}],attribute_combinations:[{id:'COLOR',value_name:'Azul Royal'},{id:'SIZE',value_name:'GG'}],picture_ids:['1-MLB123_012026']}]});
    prisma.productVariant.findUnique.mockImplementation(async(args:any)=>({id:'row',productId:'product',sku:args.where.blingAccountId_sku.sku,color:args.where.blingAccountId_sku.sku==='54446.22'?'Cinza Claro':'Azul Royal',size:'GG',stock:5,blingAccountId:'bling'} as never));(prisma.productVariant as any).findMany=jest.fn().mockResolvedValue([]);prisma.marketplaceAccount.findMany.mockResolvedValue([]);
    const chart={id:'44',seller_id:123,type:'SPECIFIC',domain_id:'SHIRTS',site_id:'MLB',names:{MLB:'Polo Levis'},rows:[{id:'44:GG',attributes:[{id:'SIZE',values:[{name:'GG'}]}]}]};
    (client as any).searchSizeCharts=jest.fn().mockResolvedValue({charts:[chart]});(client as any).getSizeChart=jest.fn().mockResolvedValue(chart);
    const plan=await service.prepareFamilyVariants(business,'user',{anuncio:'Camiseta Cinza',size_chart_id:'44',variacoes:[{sku:'54446.22',fotos:null}]});
    expect(plan.targets[0].body.attributes).toContainEqual({id:'SIZE_GRID_ID',value_name:'44'});for(const row of plan.targets[0].body.variations)expect(row.attributes).toContainEqual({id:'SIZE_GRID_ROW_ID',value_name:'44:GG'});
    expect(plan.targets[0].body.variations[0].attributes).toContainEqual({id:'SELLER_SKU',value_name:'54446.17'});expect(plan.targets[0].preview.fields.find(field=>field.field==='Tabela de medidas')?.after).toBe('Polo Levis · ID 44');expect(client.updateItem).not.toHaveBeenCalled();
  });

  function setupInheritedChart(){
    const sizes=['P','M','G','GG','XXG','XXXG'];
    const f=familySetup({domain_id:'MLB-SHIRTS',attributes:[{id:'SIZE_GRID_ID',value_name:'8319368'}],variations:sizes.map((size,index)=>({id:index+1,available_quantity:8,attributes:[{id:'SELLER_SKU',value_name:'OLD.'+index},{id:'SIZE_GRID_ROW_ID',value_name:'8319368:'+(index+1)}],attribute_combinations:[{id:'COLOR',value_name:'Original'},{id:'SIZE',value_name:size}],picture_ids:['1-MLB123_012026']}))});
    const chart={id:'8319368',seller_id:123,type:'SPECIFIC',domain_id:'SHIRTS',site_id:'MLB',names:{MLB:'Model chart'},rows:sizes.map((size,index)=>({id:'8319368:'+(index+1),attributes:[{id:'SIZE',values:[{name:size}]}]}))};
    const c:any=f.client;c.searchSizeCharts=jest.fn().mockResolvedValue({charts:[chart]});c.getSizeChart=jest.fn().mockResolvedValue(chart);
    f.prisma.productVariant.findUnique.mockImplementation(async({where}:any)=>{const sku=where.blingAccountId_sku.sku;const index=Number(sku.split('.')[1]);return {id:sku,productId:'product',blingAccountId:'bling',sku,color:sku.startsWith('OLD')?'Original':'Cor '+Math.floor(index/6),size:sizes[index%6],stock:5} as never;});
    (f.prisma.productVariant as any).findMany=jest.fn().mockResolvedValue([]);f.prisma.marketplaceAccount.findMany.mockResolvedValue([]);
    (f.service as any).bling={liveStockForSku:jest.fn().mockResolvedValue({publishable:5})};
    let nextId=100;
    c.updateItem.mockImplementation(async(_token:string,_id:string,body:any)=>{
      for(const row of body.variations.filter((row:any)=>row.id==null))if(!row.attributes.some((a:any)=>a.id==='SIZE_GRID_ROW_ID'&&a.value_name))throw Error('Missing required grid row');
      const previous=f.item.variations;
      Object.assign(f.item,{...body,variations:body.variations.map((row:any)=>row.id!=null?{...previous.find((v:any)=>String(v.id)===String(row.id)),...structuredClone(row)}:{...structuredClone(row),id:nextId++})});return structuredClone(f.item);
    });
    return {...f,chart,sizes,requested:Array.from({length:48},(_,index)=>({sku:'NEW.'+index,fotos:null}))};
  }
  it('inherits the model chart and sends the exact size row for all 48 additions across three batches',async()=>{
    const f=setupInheritedChart();const plan=await f.service.prepareFamilyVariants(business,'user',{anuncio:'Camiseta Cinza',variacoes:f.requested});
    expect(plan.targets[0].body.attributes).toContainEqual({id:'SIZE_GRID_ID',value_name:'8319368'});
    for(const row of plan.targets[0].body.variations)expect(row.attributes).toEqual(expect.arrayContaining([expect.objectContaining({id:'SIZE_GRID_ROW_ID',value_name:expect.stringMatching(/^8319368:/)})]));
    expect((await f.service.execute(plan,business,'user')).success).toBe(true);expect(f.client.updateItem).toHaveBeenCalledTimes(3);
    for(const call of f.client.updateItem.mock.calls)for(const row of call[2].variations.filter((v:any)=>v.id==null)){
      const size=row.attribute_combinations.find((a:any)=>a.id==='SIZE').value_name;
      expect(row.attributes).toContainEqual({id:'SIZE_GRID_ROW_ID',value_name:'8319368:'+(f.sizes.indexOf(size)+1)});
    }
    expect(f.item.variations).toHaveLength(54);expect(f.item.variations[0].available_quantity).toBe(8);
  });
  it('rejects an inherited chart missing a requested size before writing anything',async()=>{
    const f=setupInheritedChart();f.chart.rows=f.chart.rows.filter(row=>row.id!=='8319368:6');
    await expect(f.service.prepareFamilyVariants(business,'user',{anuncio:'Camiseta Cinza',variacoes:f.requested})).rejects.toThrow('tamanhos');expect(f.client.updateItem).not.toHaveBeenCalled();
  });
  it('automatically chooses family variants for User Products even if the AI selected the traditional tool',async()=>{
    const {service,client}=familySetup({user_product_id:'MLBU1'});
    const family=jest.spyOn((service as any).familyVariants,'prepare').mockResolvedValue({kind:'family_variants',targets:[]});
    const rows=[{id:null,sku:'54446.22',estoque:26,atributos:[{id:'COLOR',valor:'CINZA CLARO'}],fotos:[]}];
    expect((await service.prepareVariations(business,'user',{mlb:'MLB123456',variacoes:rows})).kind).toBe('family_variants');
    expect(family).toHaveBeenCalledWith(business,expect.objectContaining({item:expect.objectContaining({user_product_id:'MLBU1'})}),rows);
    expect((await service.prepareFamilyVariants(business,'user',{anuncio:'Camiseta Cinza',variacoes:[{sku:'54446.22',fotos:null}]})).kind).toBe('family_variants');
    expect(client.updateItem).not.toHaveBeenCalled();expect(client.createItem).not.toHaveBeenCalled();
  });

  it('resolves an accented name and includes every family MLB without marketplace writes', async () => {
    const { service, prisma, client, listing } = familySetup();
    (prisma.marketplaceListing as any).findMany.mockResolvedValue([listing, { ...listing, id: 'other', itemId: 'MLB654321' }]);
    client.getItem.mockImplementation(async (_token, id) => ({ ...structuredClone(listing.rawData), id, seller_id: 123, currency_id: 'BRL', price: 100, available_quantity: 8, status: 'active', title: 'Camiseta Cinza', variations: [] } as any));
    const plan = await service.prepareNamedUpdate(business, 'user', { anuncio: 'CAMISETA CÍNZA', escopo: 'pai', preco: 120 });
    expect(plan.targets.map(t => t.mlb)).toEqual(['MLB123456', 'MLB654321']);
    expect(client.updateItem).not.toHaveBeenCalled();
    expect((prisma.marketplaceListing as any).findMany.mock.calls[0][0].where.marketplaceAccount.businessKey).toBe(business.businessKey);
  });

  it('applies parent stock to all legacy variations but selected stock only to the supplied SKU', async () => {
    const { service } = familySetup({ variations: [{ id: 11, available_quantity: 3, seller_custom_field: 'SKU-P' }, { id: 12, available_quantity: 5, seller_custom_field: 'SKU-G' }] });
    const parent = await service.prepareNamedUpdate(business, 'user', { anuncio: 'Camiseta Cinza', escopo: 'pai', estoque: 7 });
    expect(parent.targets[0].body.variations).toEqual([{ id: 11, available_quantity: 7 }, { id: 12, available_quantity: 7 }]);
    const variant = await service.prepareNamedUpdate(business, 'user', { anuncio: 'Camiseta Cinza', escopo: 'variacao', variacao: 'SKU-G', estoque: 7 });
    expect(variant.targets[0].body.variations).toEqual([{ id: 11 }, { id: 12, available_quantity: 7 }]);
    await expect(service.prepareNamedUpdate(business, 'user', { anuncio: 'Camiseta Cinza', escopo: 'variacao', estoque: 7 })).rejects.toThrow('Qual variação');
    await expect(service.prepareNamedUpdate(business, 'user', { anuncio: 'Camiseta Cinza', escopo: 'variacao', variacao: 'SKU-G', preco: 120 })).rejects.toThrow('compartilha');
  });

  it('rejects ambiguous names and changed family membership before writing', async () => {
    const { service, prisma, client, listing } = familySetup();
    (prisma.marketplaceListing as any).findMany.mockResolvedValue([listing, { ...listing, marketplaceAccountId: 'another-seller' }]);
    await expect(service.identify(business, 'Camiseta Cinza')).rejects.toThrow('mais de um');
    (prisma.marketplaceListing as any).findMany.mockResolvedValue([listing]);
    const plan = await service.prepareNamedUpdate(business, 'user', { anuncio: 'Camiseta Cinza', escopo: 'pai', preco: 120 });
    (prisma.marketplaceListing as any).findMany.mockResolvedValue([listing, { ...listing, itemId: 'MLB654321' }]);
    await expect(service.execute(plan, business, 'user')).rejects.toThrow('mudaram');
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it('recalls the last explicitly named announcement and returns compact variation attributes', async () => {
    const {service,prisma,listing}=familySetup();
    listing.rawData = {...listing.rawData,attributes:[{id:'COLOR',value_name:'Cinza'},{id:'SIZE',value_name:'GG'},{id:'BRAND',value_name:'x'.repeat(12000)}]} as any;
    (prisma.marketplaceListing as any).findMany.mockResolvedValue([listing]);
    const recalled=await service.recall(business,['Camiseta Cinza. Adicione outras cores.','Faltou GG da cinza claro']);
    expect(recalled?.nome).toBe('Camiseta Cinza');
    const identified=await service.identify(business,recalled!.referencia);
    expect(JSON.stringify(identified).length).toBeLessThan(2000);
    expect(JSON.stringify(identified)).toContain('GG');
  });

  it('prepares a live before/after preview without sending a marketplace write', async () => {
    const { service, client, prisma } = setup();
    const plan = await service.prepareUpdates(business, 'user', [priceChange]);
    expect(plan.targets[0].preview.fields[0]).toEqual(expect.objectContaining({ field: 'Preço', before: expect.stringContaining('100'), after: expect.stringContaining('120') }));
    expect(client.updateItem).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(JSON.stringify(plan)).not.toContain('private-token');
    expect(prisma.marketplaceListing.findFirst.mock.calls[0][0].where.marketplaceAccount.businessKey).toBe('outlet4u');
  });

  it('checks the owner returned by ML before preparing a mutation', async () => {
    const { service, client } = setup({ seller_id: 456 });
    await expect(service.prepareUpdates(business, 'user', [priceChange])).rejects.toThrow('não pertence');
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it('rejects viewers and revoked permissions at confirmation', async () => {
    const { service, client, prisma } = setup();
    const plan = await service.prepareUpdates(business, 'user', [priceChange]);
    prisma.user.findUnique.mockResolvedValue({ active: true, role: 'VIEWER' });
    await expect(service.prepareUpdates(business, 'user', [priceChange])).rejects.toThrow('permissão');
    await expect(service.execute(plan, business, 'user')).rejects.toThrow('permissão');
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity, 1.123])('rejects invalid price %s', async price => {
    const { service } = setup();
    await expect(service.prepareUpdates(business, 'user', [{ ...priceChange, preco: price }])).rejects.toThrow('Preço');
  });

  it('blocks active price automation and rechecks it at confirmation', async () => {
    const { service, client } = setup();
    const plan = await service.prepareUpdates(business, 'user', [priceChange]);
    client.getPriceAutomation.mockResolvedValue({ status: 'ACTIVE' } as never);
    const result = await service.execute(plan, business, 'user');
    expect(result.success).toBe(false);
    expect(client.updateItem).not.toHaveBeenCalled();
    await expect(service.prepareUpdates(business, 'user', [priceChange])).rejects.toThrow('automatização');
  });

  it('rejects changed currency identity before sending the approved price', async () => {
    const { service, client, item } = setup();
    const plan = await service.prepareUpdates(business, 'user', [priceChange]);
    item.currency_id='USD';
    const result = await service.execute(plan, business, 'user');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/mudou desde a prévia|mudaram desde a prévia/);
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it('synchronizes the live listing before preview and ignores unrelated changes at confirmation', async () => {
    const {service,client,prisma,item}=setup();
    const plan=await service.prepareUpdates(business,'user',[priceChange]);
    expect(prisma.marketplaceListing.upsert.mock.calls[0][0].update.price).toBe(100);
    expect(client.updateItem).not.toHaveBeenCalled();
    Object.assign(item,{last_updated:'2026-10-08T11:00:00Z',sold_quantity:3,available_quantity:5,title:'Título atualizado por fora'});
    item.attributes.push({id:'COLOR',value_name:'Cinza'});
    item.attributes.reverse();
    expect((await service.execute(plan,business,'user')).success).toBe(true);
    expect(client.updateItem).toHaveBeenCalledTimes(1);
    expect(client.updateItem.mock.calls[0][2].price).toBe(120);
  });

  it('checks the entire batch before writing when a relevant field changed', async () => {
    const {service,client,item}=setup();
    const second={...structuredClone(item),id:'MLB654321'};
    client.getItem.mockImplementation(async (_token,id)=>structuredClone(id===second.id?second:item));
    const plan=await service.prepareUpdates(business,'user',[priceChange,{mlb:second.id,preco:120,estoque:6}]);
    second.available_quantity=7;
    const result=await service.execute(plan,business,'user');
    expect(result.status).toBe('FAILED');
    expect(result.results).toHaveLength(2);
    expect(result.message).toContain('campo Estoque');
    expect(client.updateItem).not.toHaveBeenCalled();
    expect(item.price).toBe(100);
  });

  it('recognizes approved values propagated to sibling listings without redundant writes', async () => {
    const {service,client,item,prisma}=setup({user_product_id:'UP1'});
    const second={...structuredClone(item),id:'MLB654321'};
    client.getItem.mockImplementation(async (_token,id)=>structuredClone(id===second.id?second:item));
    client.updateItem.mockImplementation(async (_token:any,_id:any,prices:any)=>{
      Object.assign(item,{price:prices.price});Object.assign(second,{price:prices.price,last_updated:'changed-by-first-write',available_quantity:6});
      return structuredClone(item);
    });
    const plan=await service.prepareUpdates(business,'user',[priceChange,{mlb:second.id,preco:120}]);
    const result=await service.execute(plan,business,'user');
    expect(result.success).toBe(true);
    expect(client.updateItem).toHaveBeenCalledTimes(1);
    expect(result.results[1].message).toContain('já estavam aplicados');
    expect(prisma.auditLog.update.mock.calls[1][0].data.after.unchanged).toBe(true);
  });

  it('rebases untouched attributes instead of overwriting their newer values', async () => {
    const {service,client,item}=setup({attributes:[{id:'BRAND',value_name:'Marca'},{id:'COLOR',value_name:'Branco'}]});
    const plan=await service.prepareUpdates(business,'user',[{mlb:item.id,atributos:[{id:'COLOR',valor:'Azul'}]}]);
    item.attributes[0].value_name='Marca atualizada';
    expect((await service.execute(plan,business,'user')).success).toBe(true);
    expect(client.updateItem.mock.calls[0][2].attributes).toEqual([{id:'BRAND',value_name:'Marca atualizada'},{id:'COLOR',value_name:'Azul'}]);
    const another=setup({attributes:[{id:'COLOR',value_name:'Branco'}]});
    const changed=await another.service.prepareUpdates(business,'user',[{mlb:another.item.id,atributos:[{id:'COLOR',valor:'Azul'}]}]);
    another.item.attributes[0].value_name='Vermelho';
    expect((await another.service.execute(changed,business,'user')).success).toBe(false);
    expect(another.client.updateItem).not.toHaveBeenCalled();
  });
  it('preserves a named fabric attribute with an empty provider ID when correcting a SKU',async()=>{
    const {service,client,item,prisma}=setup({family_id:123,user_product_id:'UP1',attributes:[{id:'FABRIC_DESIGN',value_id:'',value_name:'Liso',values:[{id:'',name:'Liso'}]},{id:'SELLER_SKU',value_name:'58906.3'}]});
    const plan=await service.prepareUpdates(business,'user',[{mlb:item.id,atributos:[{id:'SELLER_SKU',valor:'58906.23'}]}]);
    const result=await service.execute(plan,business,'user');
    expect(result.success).toBe(true);
    expect(client.updateItem.mock.calls[0][2].attributes).toContainEqual({id:'FABRIC_DESIGN',value_name:'Liso'});
    expect(client.updateItem.mock.calls[0][2].attributes).toContainEqual({id:'SELLER_SKU',value_name:'58906.23'});
    expect(prisma.auditLog.create.mock.calls[0][0].data.before).toMatchObject({familyId:123,userProductId:'UP1'});
  });

  it('preserves newer stock in untouched variations but blocks a changed variation set', async () => {
    const {service,client,item}=setup({variations:[{id:1,available_quantity:3},{id:2,available_quantity:5}]});
    client.updateItem.mockImplementation(async (_token,_id,body)=>{
      item.variations=item.variations.map((v:any)=>({...v,...body.variations.find((planned:any)=>planned.id===v.id)}));
      return structuredClone(item);
    });
    const plan=await service.prepareUpdates(business,'user',[{mlb:item.id,estoque:4,variacao_id:'1'}]);
    item.variations[1].available_quantity=7;
    expect((await service.execute(plan,business,'user')).success).toBe(true);
    expect(item.variations[1].available_quantity).toBe(7);
    const next=await service.prepareUpdates(business,'user',[{mlb:item.id,estoque:6,variacao_id:'1'}]);
    item.variations.push({id:3,available_quantity:1});
    client.updateItem.mockClear();
    expect((await service.execute(next,business,'user')).success).toBe(false);
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it('keeps description changes independent of timestamps and skips an already applied description', async () => {
    const {service,client,item}=setup();
    const plan=await service.prepareUpdates(business,'user',[{mlb:item.id,descricao:'Nova descrição'}]);
    item.last_updated='new-timestamp';item.available_quantity=4;
    client.getDescription.mockResolvedValue({plain_text:'Nova descrição'});
    expect((await service.execute(plan,business,'user')).success).toBe(true);
    expect(client.setDescription).not.toHaveBeenCalled();
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it('blocks concurrent mutations on listings that share the same user product', async () => {
    const {service,client,item}=setup({user_product_id:'UP1'});
    const second={...structuredClone(item),id:'MLB654321'};
    client.getItem.mockImplementation(async (_token,id)=>structuredClone(id===second.id?second:item));
    const firstPlan=await service.prepareUpdates(business,'user',[{mlb:item.id,preco:100}]);
    const otherPlan=await service.prepareUpdates(business,'user',[{mlb:second.id,preco:120}]);
    let release!: (value:any)=>void;
    let entered!: ()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve});
    const waiting=new Promise<any>(resolve=>{release=resolve});
    client.getItem.mockImplementationOnce(async()=>{entered();return waiting});
    const active=service.execute(firstPlan,business,'user');
    await started;
    const blocked=await service.execute(otherPlan,business,'user');
    expect(blocked.success).toBe(false);
    expect(blocked.message).toContain('em andamento');
    release(structuredClone(item));
    expect((await active).success).toBe(true);
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it('checks the business account again at confirmation', async () => {
    const { service, client, prisma } = setup();
    const plan = await service.prepareUpdates(business, 'user', [priceChange]);
    prisma.marketplaceAccount.findFirst.mockResolvedValue(null as never);
    expect((await service.execute(plan, business, 'user')).success).toBe(false);
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it('waits for delayed price visibility after one PUT without resending the mutation',async()=>{
    const {service,client,item}=setup();const plan=await service.prepareUpdates(business,'user',[priceChange]);let afterPut=0;
    (client as any).getItemPrices.mockImplementation(async()=>({prices:[{type:'standard',currency_id:'BRL',amount:client.updateItem.mock.calls.length?++afterPut<3?100:120:100,conditions:{context_restrictions:['channel_marketplace']}}]}));
    const result=await service.execute(plan,business,'user');expect(result.success).toBe(true);expect(client.updateItem).toHaveBeenCalledTimes(1);expect(client.updateItem).toHaveBeenCalledWith('private-token',item.id,{price:120});expect((client as any).updateStandardPrices).not.toHaveBeenCalled();expect((service as any).priceReadbackDelay.mock.calls.map((args:any[])=>args[0])).toEqual([1000,2000]);
  });
  it('does not claim the price is verified when propagation remains pending',async()=>{const {service,client}=setup();const plan=await service.prepareUpdates(business,'user',[priceChange]);(client as any).getItemPrices.mockResolvedValue({prices:[{type:'standard',currency_id:'BRL',amount:100,conditions:{context_restrictions:['channel_marketplace']}}]});const result=await service.execute(plan,business,'user');expect(result.success).toBe(false);expect(result.status).toBe('UNVERIFIED');expect(client.updateItem).toHaveBeenCalledTimes(1);expect((service as any).priceReadbackDelay).toHaveBeenCalledTimes(4);});
  it('writes an audit intent before updating, verifies the readback, and updates local data', async () => {
    const { service, client, prisma } = setup();
    const plan = await service.prepareUpdates(business, 'user', [priceChange]);
    const result = await service.execute(plan, business, 'user');
    expect(result.success).toBe(true);
    expect(client.updateItem).toHaveBeenCalledWith('private-token','MLB123456',{price:120});expect((client as any).updateStandardPrices).not.toHaveBeenCalled();
    expect(prisma.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(client.updateItem.mock.invocationCallOrder[0]);
    expect(prisma.auditLog.update.mock.calls[0][0].data.after.status).toBe('VERIFIED');
    expect(prisma.marketplaceListing.upsert.mock.calls[prisma.marketplaceListing.upsert.mock.calls.length-1][0].update.price).toBe(120);
  });

  it('reports unverified when ML returns HTTP success but ignores the price', async () => {
    const { service, client, prisma, item } = setup();
    const plan = await service.prepareUpdates(business, 'user', [priceChange]);
    client.updateItem.mockResolvedValue({});
    const result = await service.execute(plan, business, 'user');
    expect(result.success).toBe(false);
    expect(result.message).toContain('valores pendentes');
    expect(prisma.auditLog.update.mock.calls[0][0].data.after.status).toBe('UNVERIFIED');
  });

  it('requires a variation ID for stock and preserves all legacy variation IDs', async () => {
    const { service } = setup({ variations: [{ id: 1, available_quantity: 3 }, { id: 2, available_quantity: 5 }] });
    await expect(service.prepareUpdates(business, 'user', [{ mlb: 'MLB123456', estoque: 4 }])).rejects.toThrow('ID da variação');
    const plan = await service.prepareUpdates(business, 'user', [{ ...priceChange, estoque: 4, variacao_id: '1' }]);
    expect(plan.targets[0].body.variations).toEqual([{ id: 1, price: 120, available_quantity: 4 }, { id: 2, price: 120 }]);
    expect(plan.targets[0].body.available_quantity).toBeUndefined();
  });

  it('blocks Full and multiwarehouse stock updates', async () => {
    const full = setup({ shipping: { logistic_type: 'fulfillment' } });
    await expect(full.service.prepareUpdates(business, 'user', [{ mlb: 'MLB123456', estoque: 4 }])).rejects.toThrow('Full');
    const warehouse = setup();
    warehouse.client.getSeller.mockResolvedValue({ id: 123, tags: ['warehouse_management'] } as never);
    await expect(warehouse.service.prepareUpdates(business, 'user', [{ mlb: 'MLB123456', estoque: 4 }])).rejects.toThrow('depósito');
  });

  it('preserves untouched attributes and rejects title changes after sales', async () => {
    const { service } = setup({ sold_quantity: 2 });
    await expect(service.prepareUpdates(business, 'user', [{ mlb: 'MLB123456', titulo: 'Novo' }])).rejects.toThrow('vendas');
    const plan = await service.prepareUpdates(business, 'user', [{ mlb: 'MLB123456', atributos: [{ id: 'COLOR', valor: 'Azul' }] }]);
    expect(plan.targets[0].body.attributes).toEqual([{ id: 'BRAND', value_name: 'Marca' }, { id: 'COLOR', value_name: 'Azul' }]);
  });

  it('rejects invalid quantities, duplicate targets and oversized batches', async () => {
    const { service } = setup();
    await expect(service.prepareUpdates(business, 'user', [{ mlb: 'MLB123456', estoque: 1.5 }])).rejects.toThrow('inteiro');
    await expect(service.prepareUpdates(business, 'user', [priceChange, priceChange])).rejects.toThrow('Agrupe');
    await expect(service.prepareUpdates(business, 'user', Array(21).fill(priceChange))).rejects.toThrow('20');
  });

  it('reports each batch result without concealing a partial failure', async () => {
    const { service, client } = setup();
    const plan = await service.prepareUpdates(business, 'user', [priceChange]);
    const second = structuredClone(plan.targets[0]); second.mlb = 'MLB654321';
    plan.targets.push(second);
    client.getItem.mockImplementation(async (_token, id) => {
      if (id === 'MLB654321') throw { response: { status: 403 } };
      return { id: 'MLB123456', seller_id: 123 } as any;
    });
    const result = await service.execute(plan, business, 'user');
    expect(result.results).toHaveLength(2);
    expect(result.success).toBe(false);
  });

  it('records ambiguous write failures and never leaks provider tokens', async () => {
    const { service, client, prisma } = setup();
    const plan = await service.prepareUpdates(business, 'user', [priceChange]);
    client.updateItem.mockRejectedValue({ config: { headers: { Authorization: 'private-token' } }, message: 'private-token' });
    const result = await service.execute(plan, business, 'user');
    expect(result.success).toBe(false);
    expect(result.message).toContain('parcialmente');
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(prisma.auditLog.update.mock.calls[0][0].data.after.status).toBe('UNVERIFIED');
    expect(client.updateItem).toHaveBeenCalledTimes(1);
  });

  it('does not write if the durable audit intent cannot be saved', async () => {
    const { service, client, prisma } = setup();
    const plan = await service.prepareUpdates(business, 'user', [priceChange]);
    prisma.auditLog.create.mockRejectedValue(new Error('db unavailable'));
    expect((await service.execute(plan, business, 'user')).success).toBe(false);
    expect(client.updateItem).not.toHaveBeenCalled();
  });

  it('validates new publications without publishing and exposes inherited fields', async () => {
    const { service, client } = setup();
    const plan = await service.prepareCreate(business, 'user', { modelo_mlb: 'MLB123456', titulo: 'Nova camiseta', preco: 150, estoque: 4, sku: 'NEW' });
    expect(client.validateItem).toHaveBeenCalledTimes(1);
    expect(client.createItem).not.toHaveBeenCalled();
    expect(plan.targets[0].body.attributes).toContainEqual({ id: 'SELLER_SKU', value_name: 'NEW' });
    expect(plan.targets[0].preview.notes.join(' ')).toContain('herdados');
    expect(plan.targets[0].preview.fields[0].after).toContain('MLB100');
  });

  it('uses family_name for sellers on the User Products model', async () => {
    const { service, client } = setup();
    client.getSeller.mockResolvedValue({ id: 123, tags: ['user_product_seller'] } as never);
    const plan = await service.prepareCreate(business, 'user', { modelo_mlb: 'MLB123456', titulo: 'Nova camiseta', preco: 150, estoque: 4, sku: 'NEW' });
    expect(plan.targets[0].body.family_name).toBe('Nova camiseta');
    expect(plan.targets[0].body.title).toBeUndefined();
  });

  it('uses the live template price when the user asked for the same price', async () => {
    const {service,client,item}=setup({price:139.9});
    const plan=await service.prepareCreate(business,'user',{modelo_mlb:'MLB123456',titulo:'Nova cor',preco:null,usar_preco_modelo:true,estoque:4,sku:'54446.22'});
    expect(plan.targets[0].body.price).toBe(139.9);
    expect(plan.targets[0].preview.notes.join(' ')).toContain('Preço herdado');
    expect(client.createItem).not.toHaveBeenCalled();
    item.price=150;
    expect((await service.execute(plan,business,'user')).success).toBe(false);
    expect(client.createItem).not.toHaveBeenCalled();
    await expect(service.prepareCreate(business,'user',{modelo_mlb:'MLB123456',titulo:'Nova cor',preco:null,usar_preco_modelo:false,estoque:4,sku:'54446.22'})).rejects.toThrow('Preço');
  });

  function setupLargeAddition(){
    const f=setup({variations:[{id:1,available_quantity:8,attributes:[{id:'SELLER_SKU',value_name:'OLD'}],attribute_combinations:[{id:'COLOR',value_name:'Preto'},{id:'SIZE',value_name:'M'}]}]});
    let nextId=2;
    f.client.updateItem.mockImplementation(async(_token,_id,body)=>{
      const previous=f.item.variations;
      const variations=body.variations.map((row:any)=>row.id!=null?{...previous.find((entry:any)=>String(entry.id)===String(row.id)),...structuredClone(row)}:{...structuredClone(row),id:nextId++});
      Object.assign(f.item,{...body,variations});return structuredClone(f.item);
    });
    const variacoes=Array.from({length:48},(_,i)=>({id:null,sku:'NEW.'+(i+1),estoque:3,atributos:[{id:'COLOR',valor:'Cor '+i},{id:'SIZE',valor:'P'}],fotos:['1-MLB123_012026']}));
    return {...f,variacoes};
  }
  it('confirms 48 traditional additions in batches of 20, 20 and 8 while preserving existing IDs and stock',async()=>{
    const f=setupLargeAddition();const plan=await f.service.prepareVariations(business,'user',{mlb:f.item.id,variacoes:f.variacoes});
    const result=await f.service.execute(plan,business,'user');expect(result.success).toBe(true);
    expect(f.client.updateItem.mock.calls.map(call=>call[2].variations.filter((row:any)=>row.id==null).length)).toEqual([20,20,8]);
    expect(f.client.updateItem.mock.calls.map(call=>call[2].variations.length)).toEqual([21,41,49]);
    expect(f.item.variations.find((row:any)=>row.id===1).available_quantity).toBe(8);
    expect(new Set(f.item.variations.map((row:any)=>row.attributes.find((a:any)=>a.id==='SELLER_SKU').value_name)).size).toBe(49);
    expect(result.message).toContain('3/3');expect(f.prisma.auditLog.update.mock.calls.at(-1)![0].data.after).toMatchObject({status:'VERIFIED',variationBatches:{completed:3}});
  });
  it('stops later batches after an ambiguous write without automatically resending accepted SKUs',async()=>{
    const f=setupLargeAddition();const apply=f.client.updateItem.getMockImplementation()!;let writes=0;
    f.client.updateItem.mockImplementation(async(...args)=>{const item=await apply(...args);if(++writes===2)throw Object.assign(new Error('connection lost'),{code:'ECONNRESET'});return item;});
    const plan=await f.service.prepareVariations(business,'user',{mlb:f.item.id,variacoes:f.variacoes});
    const result=await f.service.execute(plan,business,'user');expect(result.success).toBe(false);expect(result.status).toBe('UNVERIFIED');expect(f.client.updateItem).toHaveBeenCalledTimes(2);
    expect(f.item.variations).toHaveLength(41);expect(result.message).toContain('1/3');
    expect(f.prisma.auditLog.update.mock.calls.at(-1)![0].data.after).toMatchObject({status:'UNVERIFIED',variationBatches:{completed:1}});
  });
  it('stops when the shared price changes after the first write, preserving the remaining selection',async()=>{
    const f=setupLargeAddition();const apply=f.client.updateItem.getMockImplementation()!;
    f.client.updateItem.mockImplementation(async(...args)=>{const result=await apply(...args);f.item.price=120;return result;});
    const plan=await f.service.prepareVariations(business,'user',{mlb:f.item.id,variacoes:f.variacoes});const result=await f.service.execute(plan,business,'user');
    expect(result.success).toBe(false);expect(f.client.updateItem).toHaveBeenCalledTimes(1);expect(f.item.price).toBe(120);
  });
  it('does not advance when the first batch is not visible on readback',async()=>{
    const f=setupLargeAddition();f.client.updateItem.mockImplementation(async()=>structuredClone(f.item));
    const plan=await f.service.prepareVariations(business,'user',{mlb:f.item.id,variacoes:f.variacoes});const result=await f.service.execute(plan,business,'user');
    expect(result.success).toBe(false);expect(f.client.updateItem).toHaveBeenCalledTimes(1);expect(result.message).toContain('0/3');
  });
  it('refreshes every selected Bling stock immediately before its batch without rechecking all 48 twice',async()=>{
    const f=setupLargeAddition();const bling={liveStockForSku:jest.fn().mockResolvedValue({publishable:7})};(f.service as any).bling=bling;
    const plan=await f.service.prepareVariations(business,'user',{mlb:f.item.id,variacoes:f.variacoes});plan.targets[0].refreshBlingStockForAdditions=true;
    expect((await f.service.execute(plan,business,'user')).success).toBe(true);expect(bling.liveStockForSku).toHaveBeenCalledTimes(48);
    expect(f.item.variations.filter((row:any)=>row.id!==1).every((row:any)=>row.available_quantity===7)).toBe(true);
  });
  it('preserves unrelated legacy variations when adding another variation', async () => {
    const { service } = setup({ variations: [{ id: 1, available_quantity: 8, attributes: [] }] });
    const plan = await service.prepareVariations(business, 'user', { mlb: 'MLB123456', variacoes: [{ id: null, sku: 'NEW', estoque: 3,
      atributos: [{ id: 'COLOR', valor: 'Azul' }], fotos: ['1-MLB123_012026'] }] });
    expect(plan.targets[0].body.variations[0]).toEqual({ id: 1 });
    expect(plan.targets[0].body.variations[1].attributes).toEqual([{ id: 'SELLER_SKU', value_name: 'NEW' }]);
  });

  it('checks description changes since the preview before any write', async () => {
    const { service, client } = setup();
    const plan = await service.prepareUpdates(business, 'user', [{ mlb: 'MLB123456', descricao: 'Nova descrição' }]);
    client.getDescription.mockResolvedValue({ plain_text: 'Editada fora do chat' });
    expect((await service.execute(plan, business, 'user')).success).toBe(false);
    expect(client.setDescription).not.toHaveBeenCalled();
  });
  it('allows reactivation with new stock in a specific variation', async () => {
    const {service}=setup({status:'paused',available_quantity:0,variations:[{id:1,available_quantity:0}]});
    const plan=await service.prepareUpdates(business,'user',[{mlb:'MLB123456',status:'active',estoque:4,variacao_id:'1'}]);
    expect(plan.targets[0].body.status).toBe('active');
    expect(plan.targets[0].body.variations[0].available_quantity).toBe(4);
  });
  it('allows price-only changes on Full legacy listings without attempting stock writes', async () => {
    const {service,client}=setup({shipping:{logistic_type:'fulfillment'},variations:[{id:1,price:100,available_quantity:8}]});
    const plan=await service.prepareUpdates(business,'user',[priceChange]);
    expect(plan.targets[0].body.variations).toEqual([{id:1,price:120}]);
    expect(client.getSeller).not.toHaveBeenCalled();
  });
  it('does not claim photo replacements were verified when the readback still shows old IDs', async () => {
    const {service,client,item}=setup();
    const plan=await service.prepareUpdates(business,'user',[{mlb:'MLB123456',fotos:['https://example.com/new.jpg']}]);
    client.updateItem.mockResolvedValue(item);
    const result=await service.execute(plan,business,'user');
    expect(result.success).toBe(false);
  });
  it('publishes only at confirmation and records the new MLB', async () => {
    const {service,client,prisma,item}=setup();
    const plan=await service.prepareCreate(business,'user',{modelo_mlb:'MLB123456',titulo:'Nova camiseta',preco:150,estoque:4,sku:'NEW'});
    const created={...item,id:'MLB999999',...plan.targets[0].body};
    client.createItem.mockResolvedValue(created);
    client.getItem.mockImplementation(async (_token,id)=>structuredClone(id==='MLB999999'?created:item));
    const result=await service.execute(plan,business,'user');
    expect(result.success).toBe(true);
    expect(client.createItem).toHaveBeenCalledTimes(1);
    expect(result.results[0].mlb).toBe('MLB999999');
    expect(prisma.auditLog.update.mock.calls[0][0].data.entityId).toBe('MLB999999');
  });
  it('verifies description readback and adds a missing description with POST semantics', async () => {
    const {service,client}=setup();
    client.getDescription.mockResolvedValueOnce(null as never).mockResolvedValueOnce(null as never).mockResolvedValueOnce(null as never).mockResolvedValue({plain_text:'Nova descrição'});
    const plan=await service.prepareUpdates(business,'user',[{mlb:'MLB123456',descricao:'Nova descrição'}]);
    const result=await service.execute(plan,business,'user');
    expect(result.success).toBe(true);
    expect(client.setDescription).toHaveBeenCalledWith('private-token','MLB123456','Nova descrição',false);
    expect(client.updateItem).not.toHaveBeenCalled();
  });
});

