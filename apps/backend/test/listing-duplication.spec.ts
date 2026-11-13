import { of, throwError } from 'rxjs';
import { copyAttributesMatch, copyItemBody, duplicationTitles, duplicationWarnings } from '../src/chat/listing-duplication-model';
import { ListingDuplicationTitlesService } from '../src/chat/listing-duplication-titles.service';
import { ListingDuplicationService } from '../src/chat/listing-duplication.service';

const original:any={id:'MLB1',seller_id:123,category_id:'MLB100',currency_id:'BRL',title:'Camisa Polo Original',family_name:'Camisa Polo Original',status:'active',condition:'new',listing_type_id:'gold_pro',price:120,available_quantity:3,pictures:[{id:'1-MLB123_102026'}],attributes:[{id:'SELLER_SKU',value_name:'10.1'},{id:'SIZE',value_name:'S/P'},{id:'BRAND',value_id:'1',value_name:'Marca'}],sale_terms:[{id:'WARRANTY_TYPE',value_name:'Garantia do vendedor'}],shipping:{mode:'me2',free_shipping:true,logistic_type:'xd_drop_off'}};

describe('Listing duplication models and titles',()=>{
  it('copies writable product data without reusing item, user-product or family identifiers',()=>{
    const body=copyItemBody({...original,user_product_id:'UP1',family_id:'old'},'Polo Camisa Original',true,true);
    expect(body).toMatchObject({family_name:'Polo Camisa Original',price:120,available_quantity:0,pictures:[{id:'1-MLB123_102026'}],shipping:{mode:'me2',free_shipping:true}});
    for(const key of ['id','seller_id','user_product_id','family_id','title','sold_quantity'])expect(body).not.toHaveProperty(key);
    expect(body.shipping).not.toHaveProperty('logistic_type');expect(original.available_quantity).toBe(3);
  });
  it('preserves traditional variations while stripping old variation IDs',()=>{
    const item={...original,variations:[{id:12,price:120,available_quantity:2,attribute_combinations:[{id:'COLOR',value_name:'Preto'}],attributes:[{id:'SELLER_SKU',value_name:'10.1'}],picture_ids:['1-MLB123_102026']}]};
    const body=copyItemBody(item,'Camisa Polo Nova',false,false);expect(body.title).toBe('Camisa Polo Nova');expect(body.variations[0].picture_ids).toEqual(['1-MLB123_102026']);expect(body.variations[0]).not.toHaveProperty('id');expect(body).not.toHaveProperty('available_quantity');
  });
  it('rejects Full, catalogue and incompatible legacy models before publication',()=>{
    expect(()=>copyItemBody({...original,shipping:{logistic_type:'fulfillment'}},'Copy',true,true)).toThrow('Full');
    expect(()=>copyItemBody({...original,catalog_listing:true},'Copy',true,true)).toThrow('catálogo');
    expect(()=>copyItemBody({...original,variations:[{}]},'Copy',true,true)).toThrow('migração');
  });
  it('rejects duplicates, original-title aliases, empty titles, excessive length and copy counts',()=>{
    for(const titles of [[],Array(11).fill('Camisa Polo Outra'),['Camisa Polo Original'],['Outra Camisa','OUTRA CAMISA'],[''],['x'.repeat(61)]])expect(()=>duplicationTitles(titles,'Camisa Polo Original',60)).toThrow();
    expect(duplicationTitles([' Polo  Masculina Original ','Camisa Masculina Polo'],'Camisa Polo Original',60)).toEqual(['Polo Masculina Original','Camisa Masculina Polo']);
  });
  it('compares attributes across API value formats and detects lost data',()=>{
    expect(copyAttributesMatch([{id:'SIZE',values:[{id:'1',name:'P'}]}],[{id:'SIZE',value_id:'1'}])).toBe(true);
    expect(copyAttributesMatch([{id:'SIZE',value_name:'GG'}],[{id:'SIZE',value_name:'XXG'}])).toBe(false);
  });
  it('preserves custom attribute names when Mercado Livre returns an empty value ID',()=>{
    const body=copyItemBody({...original,attributes:[{id:'NECK_TYPE',value_id:'',value_name:'Gola redonda'}]},'Polo Masculina',true,false);
    expect(body.attributes).toEqual([{id:'NECK_TYPE',value_name:'Gola redonda'}]);
  });
  it('accepts only explicitly nonblocking warnings and never suppresses real validation failures',()=>{
    expect(duplicationWarnings({response:{status:400,data:{error:'validation_error',cause:[{type:'warning',code:'item.shipping.mandatory_free_shipping'}]}}})).toEqual(['O Mercado Livre exige frete grátis para esta publicação.']);
    for(const cause of [[],[{type:'error',code:'bad'}],[{type:'warning',code:'ok'},{type:'error',code:'bad'}]])expect(duplicationWarnings({response:{status:400,data:{error:'validation_error',cause}}})).toBeUndefined();
  });
  it('generates the requested count through the configured AI and fails honestly on invalid output',async()=>{
    const config:any={get:(key:string,fallback:any)=>({CHAT_PROVIDER:'qwen',CHAT_BASE_URL:'http://localhost:1234/v1',CHAT_MODEL:'test'} as any)[key]??fallback};
    const http:any={post:jest.fn().mockReturnValue(of({data:{choices:[{message:{content:'{"titles":["Camisa Masculina Lisa Manga Curta","Camisa Masculina Gola Redonda"]}'}}]}}))};
    const service=new ListingDuplicationTitlesService(config,http);
    expect(await service.generate('Camisa Masculina Lisa Manga Curta Gola Redonda',2,60)).toHaveLength(2);
    const request=http.post.mock.calls[0][1];expect(request.messages[1].content).toContain('camisa masculina lisa manga curta gola redonda');expect(request.messages[0].content).toContain('NUNCA inclua marca');
    await expect(service.generate('Camisa Masculina Lisa Manga Curta Gola Redonda',3,60)).rejects.toThrow('IA');
    http.post.mockReturnValue(throwError(()=>new Error('secret')));await expect(service.generate('Original',1,60)).rejects.toThrow('IA');
  });
});

describe('Listing duplication approval and publication',()=>{
  function setup(){
    const rows=[original,{...original,id:'MLB2',attributes:[{id:'SELLER_SKU',value_name:'10.2'},{id:'SIZE',value_name:'M/M'}]}].map(item=>({reference:item.id,sku:item.attributes[0].value_name,body:copyItemBody(item,'Camisa Polo Original',true,false),description:'Descrição original',status:'active',variations:[],sourceFamilyId:'old'}));
    const context:any={business:{id:'bling',businessKey:'shop'},source:{token:'secret',account:{id:'ml',sellerId:'123'}},view:{title:'Camisa Polo Original',familyId:'old'},rows,version:'v1',maxTitleLength:60,userProducts:true};
    const records=new Map<string,any>(),items=new Map<string,any>(),descriptions=new Map<string,string>();let next=100;
    const prisma:any={marketplaceListing:{findMany:jest.fn().mockResolvedValue([]),findUnique:jest.fn().mockResolvedValue(null)},productVariant:{findUnique:jest.fn(async({where}:any)=>({id:'v',productId:'p',sku:where.blingAccountId_sku.sku,size:where.blingAccountId_sku.sku==='10.1'?'P':'M'}))},auditLog:{create:jest.fn(async({data}:any)=>{records.set(data.id,data);return data;}),findFirst:jest.fn(async({where}:any)=>records.get(where.id)),update:jest.fn(async({where,data}:any)=>{const record={...records.get(where.id),...data};records.set(where.id,record);return record;})}};
    const client:any={validateItem:jest.fn().mockResolvedValue({}),createItem:jest.fn(async(_token,body)=>{const id='MLB'+(++next),item={...structuredClone(body),id,seller_id:123,user_product_id:'UP'+next};items.set(id,item);return item;}),getItem:jest.fn(async(_t,id)=>items.get(id)),getUserProduct:jest.fn(async(_t,up)=>{const item=[...items.values()].find(item=>item.user_product_id===up);return {user_id:123,family_id:'family:'+item.family_name};}),getUserProductFamily:jest.fn(async(_t,family)=>({user_id:123,family_name:family.replace('family:','')})),setDescription:jest.fn(async(_t,id,text)=>{descriptions.set(id,text);}),getDescription:jest.fn(async(_t,id)=>({plain_text:descriptions.get(id)})),updateItem:jest.fn(async(_t,id,body)=>{Object.assign(items.get(id),body);return items.get(id);})};
    prisma.auditLog.updateMany=jest.fn().mockResolvedValue({count:1});prisma.$transaction=jest.fn(async(callback:any)=>callback(prisma));
    let saved:any;const pending:any={save:jest.fn(async value=>{saved=value;}),load:jest.fn(async()=>saved),claim:jest.fn(async()=>undefined)};
    const market:any={authorizeFiscal:jest.fn(),saveLocal:jest.fn()},auth:any={getValidAccessToken:jest.fn().mockResolvedValue('secret')},bling:any={liveStockForSku:jest.fn().mockResolvedValue({publishable:3})},ai:any={generate:jest.fn().mockResolvedValue(['Polo Masculina Original'])};
    const service=new ListingDuplicationService(prisma,client,auth,bling,{} as any,market,pending,ai);jest.spyOn(service as any,'context').mockImplementation(async()=>structuredClone(context));
    return {service,context,prisma,client,market,pending,bling,ai,records,items,saved:()=>saved};
  }
  const titles=['Polo Masculina Original','Camisa Masculina Polo'];
  it('uses confirmed shared product facts for AI wording without sending SKUs or color-specific attributes',async()=>{
    const f=setup();f.context.view.attributes=[{id:'BRAND',name:'Marca',value:'Polo RL'},{id:'COLOR',name:'Cor',value:'Azul'},{id:'SELLER_SKU',name:'SKU',value:'10.1'}];await f.service.titles('bling','u','MLB1',1);expect(f.ai.generate).toHaveBeenCalledWith('Camisa Polo Original',1,60,[{name:'Marca',value:'Polo RL'}]);
  });
  it('opens blank manual titles with the verified context without consulting AI or publishing',async()=>{
    const f=setup();const draft=await f.service.titles('bling','u','MLB1',2,undefined,true);
    expect(draft).toMatchObject({version:'v1',maxTitleLength:60,titles:['','']});
    expect(f.ai.generate).not.toHaveBeenCalled();
  });
  it('prepares every variation of every copy and validates without publishing',async()=>{
    const f=setup();const review=await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles});
    expect(review.totalOffers).toBe(4);expect(review.copies).toBe(2);expect(f.client.validateItem).toHaveBeenCalledTimes(4);expect(f.client.createItem).not.toHaveBeenCalled();expect(f.saved().rows.map((r:any)=>r.body.family_name)).toEqual([titles[0],titles[0],titles[1],titles[1]]);expect(JSON.stringify(f.saved())).not.toContain('secret');
  });
  it('reviews and publishes only the approved subset with the edited photo order',async()=>{
    const f=setup();const review=await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles:[titles[0]],variants:[{key:'MLB2',photos:['new-cover','new-detail']}]});
    expect(review.totalOffers).toBe(1);expect(review.rows[0].reference).toBe('MLB2');expect(f.bling.liveStockForSku).toHaveBeenCalledWith('bling','10.2');
    const job={...f.saved(),status:'RUNNING'};await (f.service as any).run('job','u',job);
    expect(job.status).toBe('COMPLETE');expect(f.client.createItem).toHaveBeenCalledTimes(1);expect(f.client.createItem.mock.calls[0][1].pictures).toEqual([{id:'new-cover'},{id:'new-detail'}]);
  });
  it('blocks stale revisions, duplicate names and invalid SKU sizes before a marketplace creation',async()=>{
    const f=setup();await expect(f.service.prepare('bling','u',{reference:'MLB1',version:'old',titles})).rejects.toThrow('mudou');
    f.prisma.marketplaceListing.findMany.mockResolvedValue([{title:titles[0],rawData:{}}]);await expect(f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles})).rejects.toThrow('em uso');
    f.prisma.marketplaceListing.findMany.mockResolvedValue([]);f.prisma.productVariant.findUnique.mockResolvedValue({sku:'10.1',size:'XXG'});await expect(f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles})).rejects.toThrow('tamanho');expect(f.client.createItem).not.toHaveBeenCalled();
  });
  it('claims confirmation once and returns the same persisted job on a repeated confirm',async()=>{
    const f=setup();const review=await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles});const a=await f.service.confirm('bling','u',review.id),b=await f.service.confirm('bling','u',review.id);expect(a).toEqual(b);expect(f.prisma.auditLog.updateMany).toHaveBeenCalledTimes(1);expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);expect(f.client.createItem).not.toHaveBeenCalled();
  });
  it('publishes the exact approved count, preserves each variation and verifies independent copy families',async()=>{
    const f=setup();const review=await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles});const job={...f.saved(),status:'RUNNING'};
    await (f.service as any).run('job','u',job);expect(f.client.createItem).toHaveBeenCalledTimes(4);expect(job.status).toBe('COMPLETE');expect(job.rows.every((r:any)=>r.state==='SUCCESS')).toBe(true);expect(new Set([...f.items.values()].map(item=>item.family_name)).size).toBe(2);expect(f.client.setDescription).toHaveBeenCalledTimes(4);expect(f.market.saveLocal).toHaveBeenCalledTimes(4);
  });
  it('never retries an ambiguous create and persists the partial outcome',async()=>{
    const f=setup();await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles});f.client.createItem.mockRejectedValueOnce(new Error('timeout secret'));const job={...f.saved(),status:'RUNNING'};await (f.service as any).run('job','u',job);expect(f.client.createItem).toHaveBeenCalledTimes(1);expect(job.status).toBe('NEEDS_REVIEW');expect(job.rows[0].state).toBe('UNVERIFIED');expect(job.message).not.toContain('secret');
  });
  it('resumes an interrupted batch by verifying existing IDs and creating only missing offers',async()=>{
    const f=setup();await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles});
    const job={...f.saved(),status:'RUNNING'};const create=f.client.createItem.getMockImplementation()!;
    f.client.createItem.mockImplementationOnce(create).mockRejectedValueOnce(new Error('temporary failure'));
    await (f.service as any).run('job','u',job);expect(job.rows[0].mlb).toBe('MLB101');
    // Only a known-ID verification interruption is safe to resume. An uncertain
    // POST without its ID must remain blocked.
    expect((f.service as any).resumable(job)).toBe(false);
    job.rows[1].state='PENDING';job.status='PARTIAL';f.records.set('job',{id:'job',after:structuredClone(job)});
    job.rows[0].state='FAILED';job.rows[0].message='Erro anterior';f.records.set('job',{id:'job',after:structuredClone(job)});
    await f.service.resume('bling','u','job');const resumed=f.prisma.auditLog.updateMany.mock.calls.at(-1)![0].data.after;
    expect(resumed.rows[0]).toMatchObject({state:'VERIFYING',message:'Aguardando nova conferência.'});
    const before=f.client.createItem.mock.calls.length,descriptionWrites=f.client.setDescription.mock.calls.length;await (f.service as any).run('job','u',resumed);
    expect(resumed.status).toBe('COMPLETE');expect(f.client.createItem.mock.calls.length-before).toBe(3);
    expect(resumed.rows[0].mlb).toBe('MLB101');expect(new Set(resumed.rows.map((r:any)=>r.mlb)).size).toBe(4);
    expect(f.client.setDescription.mock.calls.length-descriptionWrites).toBe(3);
  });
  it('updates an existing differing description instead of trying to create it again',async()=>{
    const f=setup();await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles});const job={...f.saved(),status:'RUNNING'};
    const create=f.client.createItem.getMockImplementation()!;f.client.createItem.mockImplementationOnce(create).mockRejectedValueOnce(new Error('interrupted'));
    await (f.service as any).run('job','u',job);job.rows[1].state='PENDING';job.status='PARTIAL';
    const read=f.client.getDescription.getMockImplementation()!;
    f.client.getDescription.mockImplementationOnce(async()=>({plain_text:'Descrição antiga'})).mockImplementation(read);
    const writes=f.client.setDescription.mock.calls.length;await (f.service as any).run('job','u',job);
    expect(job.status).toBe('COMPLETE');expect(f.client.setDescription.mock.calls[writes]).toEqual(['secret','MLB101','Descrição original',true]);
  });
  it('blocks resume for an unknown create result, wrong scope or a stale source',async()=>{
    const f=setup();await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles});
    const job={...f.saved(),status:'NEEDS_REVIEW'};job.rows[0].state='UNVERIFIED';f.records.set('job',{id:'job',after:job});
    await expect(f.service.resume('bling','u','job')).rejects.toThrow('conferência manual');
    await expect(f.service.resume('bling','u','absent')).rejects.toThrow('não encontrada');
    job.rows[0].mlb='MLB101';job.version='outdated';
    await expect(f.service.resume('bling','u','job')).rejects.toThrow('mudou');expect(f.client.createItem).not.toHaveBeenCalled();
  });
  it('finds an earlier batch from any original variation while retaining user, source and destination scope',async()=>{
    const f=setup();f.prisma.auditLog.findFirst.mockResolvedValue(null);
    await f.service.latest('bling','u','MLB2','other-destination');
    expect(f.prisma.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({entityId:'bling',userId:'u',AND:[{OR:[{after:{path:['reference'],equals:'MLB2'}},{after:{path:['rows'],array_contains:[{reference:'MLB2'}]}}]},{after:{path:['destinationAccountId'],equals:'other-destination'}}]})}));
  });
  it('rejects a copy that points to the original family before changing its stock or status',async()=>{
    const f=setup();await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles});f.client.getUserProduct.mockResolvedValue({user_id:123,family_id:'old'});const job={...f.saved(),status:'RUNNING'};await (f.service as any).run('job','u',job);expect(job.status).toBe('NEEDS_REVIEW');expect(f.client.createItem).toHaveBeenCalledTimes(1);expect(f.client.updateItem).not.toHaveBeenCalled();expect(f.client.setDescription).not.toHaveBeenCalled();
  });
  it('stops an expired running job without sending another publication',async()=>{
    const f=setup();f.prisma.auditLog.findFirst.mockResolvedValue({id:'job',after:{status:'RUNNING',leaseUntil:0,rows:[{state:'SENDING'}]}});f.prisma.auditLog.updateMany=jest.fn().mockResolvedValue({count:1});await f.service.tick();expect(f.prisma.auditLog.updateMany.mock.calls[0][0].data.after.status).toBe('NEEDS_REVIEW');expect(f.client.createItem).not.toHaveBeenCalled();
  });
  it('initializes and verifies the approved warehouse with fresh Bling stock for every new user product',async()=>{
    const f=setup();f.context.warehouse={store_id:'store',network_node_id:'node'};
    const stocks=new Map<string,any>();
    f.client.getProductStock=jest.fn(async(_token:string,up:string)=>stocks.get(up)??null);
    f.client.initializeWarehouseStock=jest.fn(async(_token:string,up:string,location:any)=>{stocks.set(up,{version:'1',data:{id:up,user_id:123,locations:[{...location,type:'seller_warehouse'}]}});for(const item of f.items.values())if(item.user_product_id===up)item.available_quantity=location.quantity;});
    await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles:[titles[0]]});const job={...f.saved(),status:'RUNNING'};
    expect(job.rows.every((r:any)=>r.body.available_quantity===0)).toBe(true);
    await (f.service as any).run('job','u',job);expect(job.status).toBe('COMPLETE');expect(f.client.initializeWarehouseStock).toHaveBeenCalledTimes(2);expect([...stocks.values()].every(stock=>stock.data.locations[0].quantity===3)).toBe(true);
  });
  it('keeps zero-stock copies paused and preserves original paused offers',async()=>{
    const f=setup();f.bling.liveStockForSku.mockResolvedValue({publishable:0});await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles:[titles[0]]});const job={...f.saved(),status:'RUNNING'};await (f.service as any).run('job','u',job);expect(job.status).toBe('COMPLETE');expect([...f.items.values()].every(item=>item.status==='paused'&&item.available_quantity===0)).toBe(true);
  });
  it('checks permission again when confirming and scopes job retrieval to account and user',async()=>{
    const f=setup();const review=await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles});f.market.authorizeFiscal.mockRejectedValueOnce(new Error('Permission revoked'));await expect(f.service.confirm('bling','u',review.id)).rejects.toThrow('Permission revoked');expect(f.pending.claim).not.toHaveBeenCalled();
    await expect(f.service.status('other-account','other-user','job')).rejects.toThrow('não encontrada');expect(f.prisma.auditLog.findFirst).toHaveBeenLastCalledWith({where:{id:'job',action:'LISTING_DUPLICATION_JOB',entityId:'other-account',userId:'other-user'}});
  });
  it('does not publish if a blocking error is returned by validation',async()=>{
    const f=setup();f.client.validateItem.mockRejectedValue({response:{status:400,data:{error:'validation_error',cause:[{type:'error',code:'item.attributes.invalid'}]}}});await expect(f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles})).rejects.toThrow('item.attributes.invalid');expect(f.client.createItem).not.toHaveBeenCalled();expect(f.pending.save).not.toHaveBeenCalled();
  });
  it('rejects branded manual titles before preparing a review without changing the original BRAND attribute',async()=>{
    const f=setup();f.context.view.attributes=[{id:'BRAND',name:'Marca',value:'Ralph Lauren'}];
    await expect(f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles:['Camisa Ralph Lauren Masculina']})).rejects.toThrow('marca');
    expect(f.pending.save).not.toHaveBeenCalled();expect(f.client.createItem).not.toHaveBeenCalled();
    await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles:['Camisa Masculina Manga Curta']});
    expect(f.saved().rows[0].body.attributes.find((a:any)=>a.id==='BRAND')).toEqual(f.context.rows[0].body.attributes.find((a:any)=>a.id==='BRAND'));
  });
  it('blocks previously prepared branded reviews and queued copies under the new brand-free policy',async()=>{
    const f=setup();f.context.view.attributes=[{id:'BRAND',name:'Marca',value:'Ralph Lauren'}];
    const review=await f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles:['Camisa Masculina Manga Curta']});
    f.saved().titles=['Camisa RL Masculina'];
    await expect(f.service.confirm('bling','u',review.id)).rejects.toThrow('marca');expect(f.prisma.$transaction).not.toHaveBeenCalled();
    const job={...f.saved(),status:'RUNNING'};await (f.service as any).run('job','u',job);expect(job.status).toBe('FAILED');expect(f.client.createItem).not.toHaveBeenCalled();
  });
  it('uses the live item BRAND when the family attribute list omits it',async()=>{
    const f=setup();f.context.source.item={attributes:[{id:'BRAND',value_name:'Hering'}]};await expect(f.service.prepare('bling','u',{reference:'MLB1',version:'v1',titles:['Camisa Hering Masculina']})).rejects.toThrow('marca');expect(f.client.createItem).not.toHaveBeenCalled();
  });
});
