import { ListingCreationService } from '../src/chat/listing-creation.service';
import { BlingSyncService } from '../src/bling/synchronization/bling-sync.service';
import { routePermissions } from '../src/auth/permissions';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../src/auth/jwt.guard';
import { ListingCreationController } from '../src/chat/listing-creation.controller';

function setup(modern=true,warehouse=false){
  const source:any={product:{id:'p',sku:'10',title:'Camisa Manga Curta',description:'Produto Bling',brand:'Marca',photos:['https://images.example.org/shirt.jpg'],dimensions:{}},rows:[{id:'v1',sku:'10.1',color:'Azul',size:'P',price:100,gtin:'123',photos:[],stock:99},{id:'v2',sku:'10.2',color:'Azul',size:'M',price:100,gtin:'456',photos:[],stock:99}]};
  const account={id:'ml',sellerId:'123',name:'Minha loja'},records=new Map<string,any>(),items=new Map<string,any>(),descriptions=new Map<string,string>();let next=100;
  const prisma:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'bling',businessKey:'shop'}),findMany:jest.fn().mockResolvedValue([account])},marketplaceListing:{findMany:jest.fn().mockResolvedValue([]),findUnique:jest.fn().mockResolvedValue({id:'local'})},marketplaceListingVariant:{findUnique:jest.fn(async({where}:any)=>({id:'local:'+where.listingId_variationId.variationId}))},productVariant:{findUnique:jest.fn(async({where}:any)=>({id:'v',productId:'p',sku:where.blingAccountId_sku.sku}))},listingProductLink:{findFirst:jest.fn().mockResolvedValue(null),create:jest.fn()},auditLog:{create:jest.fn(async({data}:any)=>{records.set(data.id,data);return data;}),findFirst:jest.fn(async({where}:any)=>{const r=records.get(where.id);return r&&r.entityId===where.entityId&&r.userId===where.userId?r:null;}),update:jest.fn(async({where,data}:any)=>{records.set(where.id,{...records.get(where.id),...data});return records.get(where.id);}),updateMany:jest.fn().mockResolvedValue({count:1})}};
  prisma.$transaction=jest.fn(async(callback:any)=>callback(prisma));
  const client:any={getAuthenticatedSeller:jest.fn().mockResolvedValue({id:123}),getSeller:jest.fn().mockResolvedValue({id:123,tags:[...(modern?['user_product_seller']:[]),...(warehouse?['warehouse_management']:[])]}),getWarehouses:jest.fn().mockResolvedValue([{id:'store',network_node_id:'node',status:'active',user_id:123}]),predictCategories:jest.fn().mockResolvedValue([{category_id:'MLB100',category_name:'Camisas'}]),category:jest.fn().mockResolvedValue({category:{id:'MLB100',name:'Camisas',settings:{max_title_length:60,catalog_domain:'MLB-SHIRTS'}},attributes:[{id:'BRAND',name:'Marca',tags:{required:true}},{id:'COLOR'},{id:'SIZE'},{id:'SELLER_SKU'},{id:'GTIN'}]}),validateItem:jest.fn().mockResolvedValue({}),createItem:jest.fn(async(_t,body)=>{const id='MLB'+(++next),item={...structuredClone(body),id,seller_id:123,user_product_id:'UP'+next,pictures:body.pictures.map((p:any,i:number)=>({id:p.id??`${i}-MLB999_202610`}))};if(item.variations)for(const variation of item.variations)variation.picture_ids=variation.picture_ids.map((reference:string)=>{const position=body.pictures.findIndex((picture:any)=>(picture.id??picture.source)===reference);return item.pictures[position]?.id;});items.set(id,item);return item;}),getItem:jest.fn(async(_t,id)=>items.get(id)),getUserProduct:jest.fn().mockResolvedValue({user_id:123,family_id:'family'}),getUserProductFamily:jest.fn().mockResolvedValue({user_id:123,family_name:'Camisa Manga Curta'}),setDescription:jest.fn(async(_t,id,text)=>descriptions.set(id,text)),getDescription:jest.fn(async(_t,id)=>({plain_text:descriptions.get(id)})),updateItem:jest.fn(async(_t,id,body)=>Object.assign(items.get(id),body)),getProductStock:jest.fn().mockResolvedValue(null),initializeWarehouseStock:jest.fn(),updateWarehouseStock:jest.fn(),uploadPicture:jest.fn()};
  let saved:any;
  const pending:any={save:jest.fn(async(v:any)=>{saved=v;}),load:jest.fn(async()=>saved)};
  const market:any={authorizeFiscal:jest.fn(),saveLocal:jest.fn()},auth:any={getValidAccessToken:jest.fn().mockResolvedValue('secret')},bling:any={publicationSource:jest.fn(async()=>structuredClone(source)),liveStockForSku:jest.fn().mockResolvedValue({publishable:3})};
  const copy:any={generate:jest.fn().mockResolvedValue({title:'Camisa Manga Curta',characters:18,description:'Produto Bling',keywords:[],notes:[]})};const service=new ListingCreationService(prisma,client,auth,bling,market,pending,copy,{} as any);
  const draft=async()=>{const lookup:any=await service.lookup('bling','u','10');return {sku:'10',version:lookup.version!,title:'Camisa Manga Curta',categoryId:'MLB100',listingTypeId:'gold_special',condition:'new',description:'Produto Bling',freeShipping:false,rows:source.rows.map((r:any)=>({sku:r.sku,price:r.price,gtin:r.gtin})),attributes:[{id:'BRAND',value:'Marca'}],photos:['https://images.example.org/shirt.jpg']} as any;};
  return {service,source,prisma,client,pending,market,auth,bling,records,items,copy,draft,saved:()=>saved};
}

describe('Creation from Bling, without an existing listing',()=>{
  it('shows shipping package fields as required and validates them before consulting Mercado Livre',async()=>{
    const f=setup(),definitions=await f.client.category();definitions.attributes.push(...['HEIGHT','WIDTH','LENGTH','WEIGHT'].map(key=>({id:'SELLER_PACKAGE_'+key,name:key,tags:{}})));
    const category=await f.service.category('bling','u','MLB100');expect(category.attributes.filter((a:any)=>a.id.startsWith('SELLER_PACKAGE_')).every((a:any)=>a.required)).toBe(true);
    const input=await f.draft();await expect(f.service.prepare('bling','u',input)).rejects.toThrow('Altura da embalagem (cm)');expect(f.client.validateItem).not.toHaveBeenCalled();
    input.attributes.push({id:'SELLER_PACKAGE_HEIGHT',value:'3'},{id:'SELLER_PACKAGE_WIDTH',value:'10,5 cm'},{id:'SELLER_PACKAGE_LENGTH',value:'0.2 m'},{id:'SELLER_PACKAGE_WEIGHT',value:'0,45 kg'});
    await f.service.prepare('bling','u',input);expect(f.saved().rows[0].body.attributes).toEqual(expect.arrayContaining([{id:'SELLER_PACKAGE_HEIGHT',value_name:'3 cm'},{id:'SELLER_PACKAGE_WIDTH',value_name:'10.5 cm'},{id:'SELLER_PACKAGE_LENGTH',value_name:'20 cm'},{id:'SELLER_PACKAGE_WEIGHT',value_name:'450 g'}]));
  });
  it('rejects zero package measurements and incompatible units before validation or publication',async()=>{const f=setup(),definitions=await f.client.category();definitions.attributes.push({id:'SELLER_PACKAGE_HEIGHT',name:'Altura',tags:{}});const input=await f.draft();input.attributes.push({id:'SELLER_PACKAGE_HEIGHT',value:'0'});await expect(f.service.prepare('bling','u',input)).rejects.toThrow('maior que zero');input.attributes[1].value='10 kg';await expect(f.service.prepare('bling','u',input)).rejects.toThrow('Altura da embalagem');expect(f.client.validateItem).not.toHaveBeenCalled();expect(f.client.createItem).not.toHaveBeenCalled();});
  it('receives a real multipart photo and detects its bytes even when filename and MIME disagree',async()=>{
    const f=setup();f.client.uploadPicture.mockResolvedValue({id:'101-MLB999_202610',variations:[{secure_url:'https://images.example.org/confirmed.png'}]});
    const module=await Test.createTestingModule({controllers:[ListingCreationController],providers:[{provide:ListingCreationService,useValue:f.service}]}).overrideGuard(JwtAuthGuard).useValue({canActivate:(ctx:any)=>{ctx.switchToHttp().getRequest().user={id:'u'};return true;}}).compile();
    const app=module.createNestApplication({logger:false});await app.init();
    try{const request=require('supertest');const buffer=Buffer.from([137,80,78,71,13,10,26,10,0]);const response=await request(app.getHttpServer()).post('/chat/listing-creation/photos/upload?marketplaceAccountId=bling').attach('file',buffer,{filename:'foto.jpg',contentType:'application/octet-stream'});expect(response.status).toBe(201);expect(response.body).toEqual({id:'101-MLB999_202610',url:'https://images.example.org/confirmed.png'});expect(f.client.uploadPicture).toHaveBeenCalledWith('secret',buffer,'image/png');const missing=await request(app.getHttpServer()).post('/chat/listing-creation/photos/upload?marketplaceAccountId=bling');expect(missing.status).toBe(400);expect(missing.body.message).toContain('não chegou');}
    finally{await app.close();}
  });
  it('distinguishes oversized files from unsupported encodings without uploading them',async()=>{const f=setup();await expect(f.service.upload('bling','u',{buffer:Buffer.alloc(10*1024*1024+1),mimetype:'image/jpeg'})).rejects.toThrow('10 MB');await expect(f.service.upload('bling','u',{buffer:Buffer.from('RIFFxxxxWEBP'),mimetype:'image/jpeg'})).rejects.toThrow('codificada');expect(f.client.uploadPicture).not.toHaveBeenCalled();});
  it('publishes only the approved photos for each SKU with the approved cover and ordering',async()=>{
    const f=setup(),input=await f.draft();input.photos=[];input.rows[0].photos=['102-MLB999_202610','101-MLB999_202610'];input.rows[1].photos=['103-MLB999_202610'];
    const review=await f.service.prepare('bling','u',input);expect(review.rows.map(row=>row.photos)).toEqual(input.rows.map((row:any)=>row.photos));expect(review.photos).toHaveLength(3);
    expect(f.saved().rows.map((row:any)=>row.body.pictures)).toEqual([[{id:'102-MLB999_202610'},{id:'101-MLB999_202610'}],[{id:'103-MLB999_202610'}]]);
    const job=structuredClone(f.saved());await (f.service as any).run('job','u',job);expect(job.status).toBe('COMPLETE');expect(f.client.createItem.mock.calls[0][1].pictures).toEqual([{id:'102-MLB999_202610'},{id:'101-MLB999_202610'}]);expect(f.client.createItem.mock.calls[1][1].pictures).toEqual([{id:'103-MLB999_202610'}]);
  });
  it('keeps separate picture assignments in traditional variations while merging the item gallery',async()=>{
    const f=setup(false),input=await f.draft();input.photos=[];input.rows[0].photos=['101-MLB999_202610'];input.rows[1].photos=['102-MLB999_202610'];await f.service.prepare('bling','u',input);
    const body=f.saved().rows[0].body;expect(body.pictures).toEqual([{id:'101-MLB999_202610'},{id:'102-MLB999_202610'}]);expect(body.variations.map((v:any)=>v.picture_ids)).toEqual([['101-MLB999_202610'],['102-MLB999_202610']]);
    const job=structuredClone(f.saved());await (f.service as any).run('job','u',job);expect(job.status).toBe('COMPLETE');
  });
  it('blocks publication when any selected SKU is missing its photos',async()=>{const f=setup(),input=await f.draft();input.photos=[];input.rows[0].photos=['101-MLB999_202610'];await expect(f.service.prepare('bling','u',input)).rejects.toThrow('10.2');expect(f.pending.save).not.toHaveBeenCalled();expect(f.client.createItem).not.toHaveBeenCalled();});
  it('does not activate a listing if Mercado Livre changes the approved cover',async()=>{
    const f=setup(),input=await f.draft();input.photos=[];input.rows.forEach((r:any)=>r.photos=['101-MLB999_202610','102-MLB999_202610']);await f.service.prepare('bling','u',input);const create=f.client.createItem.getMockImplementation()!;f.client.createItem.mockImplementation(async(t:any,b:any)=>{const item=await create(t,b);item.pictures.reverse();return item;});const job=structuredClone(f.saved());await (f.service as any).run('job','u',job);expect(job.status).toBe('NEEDS_REVIEW');expect(f.client.updateItem).not.toHaveBeenCalled();
  });
  it('rejects photos assigned to the wrong traditional variation on readback',async()=>{
    const f=setup(false),input=await f.draft();input.photos=[];input.rows[0].photos=['101-MLB999_202610'];input.rows[1].photos=['102-MLB999_202610'];await f.service.prepare('bling','u',input);const create=f.client.createItem.getMockImplementation()!;f.client.createItem.mockImplementation(async(t:any,b:any)=>{const item=await create(t,b);item.variations[1].picture_ids=item.variations[0].picture_ids;return item;});const job=structuredClone(f.saved());await (f.service as any).run('job','u',job);expect(job.status).toBe('NEEDS_REVIEW');expect(f.client.updateItem).not.toHaveBeenCalled();
  });
  it('distinguishes same-name category suggestions using the verified parent path',async()=>{const f=setup();f.client.predictCategories.mockResolvedValue([{category_id:'MLB100',category_name:'Camisetas'},{category_id:'MLB200',category_name:'Camisetas'}]);f.client.category.mockImplementation(async(_t:any,id:string)=>({category:{id,name:'Camisetas',settings:{},path_from_root:[{name:'Roupas e Acessórios'},{name:id==='MLB100'?'Roupas Femininas':'Roupas Masculinas'},{name:'Camisetas'}]},attributes:[]}));const result:any=await f.service.lookup('bling','u','10');expect(result.categories[0].path).toContain('Femininas');expect(result.categories[1].path).toContain('Masculinas');expect((await f.service.category('bling','u','MLB100')).path).toContain('Femininas');});
  it('generates copy from the scoped live Bling product and selected category without publishing',async()=>{const f=setup(),d=await f.draft();const input={sku:d.sku,version:d.version,categoryId:d.categoryId,rows:[{sku:'10.1'}],attributes:d.attributes};await f.service.generateCopy('bling','u',input);expect(f.copy.generate).toHaveBeenCalledWith(expect.objectContaining({title:f.source.product.title,description:'Produto Bling',brand:'Marca',colors:['Azul'],sizes:['P','M'],hasVariations:true,max:60}));expect(f.client.createItem).not.toHaveBeenCalled();expect(f.pending.save).not.toHaveBeenCalled();input.rows=[{sku:'outside'}];await expect(f.service.generateCopy('bling','u',input)).rejects.toThrow('variações deste produto');expect(f.copy.generate).toHaveBeenCalledTimes(1);});
  it('builds User Product offers only from the selected Bling variants and live stocks, with no publication before confirmation',async()=>{
    const f=setup(),input=await f.draft(),review=await f.service.prepare('bling','u',input);
    expect(review.rows).toEqual([expect.objectContaining({sku:'10.1',stock:3,price:100}),expect.objectContaining({sku:'10.2',stock:3,price:100})]);
    expect(f.saved().rows[0].body).toMatchObject({family_name:'Camisa Manga Curta',available_quantity:3,status:'paused',attributes:expect.arrayContaining([{id:'SELLER_SKU',value_name:'10.1'},{id:'COLOR',value_name:'Azul'},{id:'SIZE',value_name:'P'}])});
    expect(f.saved().rows[0].body).not.toHaveProperty('title');expect(f.saved().rows[0].body).not.toHaveProperty('id');expect(f.client.createItem).not.toHaveBeenCalled();expect(f.pending.save).toHaveBeenCalledTimes(1);
  });
  it('publishes and verifies all offers, activates valid stock and creates exact Bling links',async()=>{
    const f=setup();await f.service.prepare('bling','u',await f.draft());const job=structuredClone(f.saved());await (f.service as any).run('job','u',job);
    expect(job.status).toBe('COMPLETE');expect(f.client.createItem).toHaveBeenCalledTimes(2);expect(f.market.saveLocal).toHaveBeenCalledTimes(2);expect(f.prisma.listingProductLink.create).toHaveBeenCalledTimes(2);expect([...f.items.values()].every(item=>item.status==='active')).toBe(true);
  });
  it('supports traditional variations and keeps their individual SKU, size and quantity',async()=>{
    const f=setup(false);const r=await f.service.prepare('bling','u',await f.draft());expect(r.totalOffers).toBe(1);expect(f.saved().rows[0].body.variations).toHaveLength(2);expect(f.saved().rows[0].body).not.toHaveProperty('family_name');
    const job=structuredClone(f.saved());await (f.service as any).run('job','u',job);expect(job.status).toBe('COMPLETE');expect(f.client.createItem).toHaveBeenCalledTimes(1);expect(f.prisma.listingProductLink.create).toHaveBeenCalledTimes(2);
  });
  it('rejects distinct variation prices on traditional sellers',async()=>{const f=setup(false),input=await f.draft();input.rows[1].price=110;await expect(f.service.prepare('bling','u',input)).rejects.toThrow('mesmo preço');expect(f.client.createItem).not.toHaveBeenCalled();});
  it('blocks a changed Bling source and a forged or repeated variation',async()=>{
    const f=setup(),input=await f.draft();f.source.rows[0].color='Preto';await expect(f.service.prepare('bling','u',input)).rejects.toThrow('Bling mudaram');
    const current=await f.draft();current.rows[0].sku='another-product';await expect(f.service.prepare('bling','u',current)).rejects.toThrow('fora do produto');
    current.rows[0]=current.rows[1];await expect(f.service.prepare('bling','u',current)).rejects.toThrow('repetidos');
  });
  it('does not invalidate the source fingerprint because cached stock changed',async()=>{const f=setup(),input=await f.draft();f.source.rows[0].stock=1;await expect(f.service.prepare('bling','u',input)).resolves.toHaveProperty('id');});
  it('blocks wrong seller identity, revoked permission and ambiguous connected sellers',async()=>{
    const f=setup();f.client.getAuthenticatedSeller.mockResolvedValue({id:456});await expect(f.service.lookup('bling','u','10')).rejects.toThrow('vendedor');
    f.client.getAuthenticatedSeller.mockResolvedValue({id:123});f.prisma.marketplaceAccount.findMany.mockResolvedValue([{},{}]);await expect(f.service.lookup('bling','u','10')).rejects.toThrow('única conta');
    f.market.authorizeFiscal.mockRejectedValue(new Error('Denied'));await expect(f.service.lookup('bling','u','10')).rejects.toThrow('Denied');expect(routePermissions('GET','/chat/listing-creation/job')).toEqual([['listings.manage']]);
  });
  it('checks required category data and forbids managed or read-only attributes',async()=>{
    const f=setup(),input=await f.draft();input.attributes=[];await expect(f.service.prepare('bling','u',input)).rejects.toThrow('Marca');
    input.attributes=[{id:'SELLER_SKU',value:'other'}];await expect(f.service.prepare('bling','u',input)).rejects.toThrow('inválida');expect(f.pending.save).not.toHaveBeenCalled();
  });
  it('does not suppress blocking provider validation or missing mandatory free shipping',async()=>{
    const f=setup(),input=await f.draft();f.client.validateItem.mockRejectedValue({response:{status:400,data:{error:'validation_error',cause:[{type:'error',code:'item.attribute.missing'}]}}});await expect(f.service.prepare('bling','u',input)).rejects.toThrow('item.attribute.missing');
    f.client.validateItem.mockRejectedValue({response:{status:400,data:{error:'validation_error',cause:[{type:'warning',code:'item.shipping.mandatory_free_shipping'}]}}});await expect(f.service.prepare('bling','u',input)).rejects.toThrow('Marque a opção');expect(f.pending.save).not.toHaveBeenCalled();
  });
  it('rejects private image URLs and existing family names',async()=>{
    const f=setup(),input=await f.draft();for(const url of ['http://a.com/a.jpg','https://127.0.0.1/a.jpg','https://172.16.0.1/a.jpg','https://localhost/a.jpg']){input.photos=[url];await expect(f.service.prepare('bling','u',input)).rejects.toThrow('pública');}
    f.prisma.marketplaceListing.findMany.mockResolvedValue([{title:'Camisa Manga Curta'}]);await expect(f.service.prepare('bling','u',input)).rejects.toThrow('já está em uso');
  });
  it('creates only one durable job for repeated confirmations and scopes status by user and account',async()=>{
    const f=setup(),review=await f.service.prepare('bling','u',await f.draft());const one=await f.service.confirm('bling','u',review.id),two=await f.service.confirm('bling','u',review.id);expect(one).toEqual(two);expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);expect(f.client.createItem).not.toHaveBeenCalled();await expect(f.service.status('other','u',one.jobId)).rejects.toThrow('não encontrada');
  });
  it('rejects expired reviews and loses no approved job on permission revocation',async()=>{
    const f=setup(),review=await f.service.prepare('bling','u',await f.draft());f.saved().expiresAt=0;await expect(f.service.confirm('bling','u',review.id)).rejects.toThrow('expirou');expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rechecks Bling stock at execution and keeps zero-stock offers paused',async()=>{
    const f=setup();await f.service.prepare('bling','u',await f.draft());f.bling.liveStockForSku.mockResolvedValue({publishable:0});const job=structuredClone(f.saved());await (f.service as any).run('job','u',job);expect(job.status).toBe('COMPLETE');expect([...f.items.values()].every(item=>item.status==='paused'&&item.available_quantity===0)).toBe(true);
  });
  it('never retries an uncertain create request and exposes a review-needed result',async()=>{
    const f=setup();await f.service.prepare('bling','u',await f.draft());f.client.createItem.mockRejectedValue(new Error('timeout'));const job=structuredClone(f.saved());await (f.service as any).run('job','u',job);expect(job.status).toBe('NEEDS_REVIEW');expect(f.client.createItem).toHaveBeenCalledTimes(1);expect(f.market.saveLocal).not.toHaveBeenCalled();
  });
  it('does not activate or link offers with a wrong SKU, picture, or family',async()=>{
    for(const defect of ['sku','photo','family']){
      const f=setup();await f.service.prepare('bling','u',await f.draft());
      if(defect==='family')f.client.getUserProductFamily.mockResolvedValue({user_id:456,family_name:'Camisa Manga Curta'});
      else{const create=f.client.createItem.getMockImplementation()!;f.client.createItem.mockImplementation(async(t:any,b:any)=>{const item=await create(t,b);if(defect==='sku')item.attributes.find((a:any)=>a.id==='SELLER_SKU').value_name='wrong';else item.pictures=[];return item;});}
      const job=structuredClone(f.saved());await (f.service as any).run('job','u',job);expect(job.status).toBe('NEEDS_REVIEW');expect(f.client.updateItem).not.toHaveBeenCalled();expect(f.prisma.listingProductLink.create).not.toHaveBeenCalled();
    }
  });
  it('initializes a verified warehouse stock before activating',async()=>{
    const f=setup(true,true);await f.service.prepare('bling','u',await f.draft());expect(f.saved().rows[0].body.available_quantity).toBe(0);
    f.client.getProductStock.mockResolvedValueOnce(null).mockResolvedValueOnce({data:{locations:[{store_id:'store',network_node_id:'node',quantity:3}]}}).mockResolvedValueOnce(null).mockResolvedValueOnce({data:{locations:[{store_id:'store',network_node_id:'node',quantity:3}]}});
    const job=structuredClone(f.saved());await (f.service as any).run('job','u',job);expect(job.status).toBe('COMPLETE');expect(f.client.initializeWarehouseStock).toHaveBeenCalledTimes(2);
  });
  it('fails before any create when one SKU stock cannot be confirmed',async()=>{const f=setup();await f.service.prepare('bling','u',await f.draft());f.bling.liveStockForSku.mockRejectedValue(new Error('unavailable'));const job=structuredClone(f.saved());await (f.service as any).run('job','u',job);expect(job.status).toBe('FAILED');expect(f.client.createItem).not.toHaveBeenCalled();});
});

describe('Authoritative Bling product source',()=>{
  function source(){const product:any={id:'p',blingAccountId:'o',blingProductId:'1',sku:'10',title:'Cached',variants:[{id:'v',blingVariantId:'2',sku:'10.1',color:'Old',size:'P',stock:90}]};const prisma:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({accessToken:'secret'})},productVariant:{findUnique:jest.fn().mockResolvedValue(null)},product:{findMany:jest.fn().mockResolvedValue([product])}};const service:any=new BlingSyncService(prisma,{} as any,{} as any,{} as any);service.get=jest.fn().mockImplementation(async(path:string)=>path.endsWith('/anexos')?[{url:'https://images.example.org/bling.jpg'}]:({id:1,sku:'10',descricao:'Live',marca:{nome:'Marca'},precos:{preco:100,precoPromocional:90},dimensoes:{pesoBruto:.4},anexos:[{link:'https://images.example.org/bling.jpg'}],variacoes:[{id:2,sku:'10.1',descricao:'Live P',grade:[{chave:'Cor',valor:'Azul'},{chave:'Tamanho',valor:'P'}],precos:{preco:100,precoPromocional:85},gtin:'123'}]}));return {service,prisma,product};}
  it('loads live Bling grade and prices while preserving the selected account scope',async()=>{const f=source(),r=await f.service.publicationSource('o','10');expect(r.product.title).toBe('Live');expect(r.product.photos).toEqual(['https://images.example.org/bling.jpg']);expect(r.product.dimensions.weightGrams).toBe(400);expect(r.rows[0]).toMatchObject({sku:'10.1',price:85,color:'Azul'});expect(f.prisma.product.findMany.mock.calls[0][0].where.blingAccountId).toBe('o');});
  it('returns explicit line choices instead of merging separate parent products',async()=>{const f=source();f.prisma.product.findMany.mockResolvedValue([{...f.product,sku:'10-LINHA1'},{...f.product,sku:'10-LINHA2'}]);expect((await f.service.publicationSource('o','10')).matches).toHaveLength(2);expect(f.service.get).not.toHaveBeenCalled();});
  it('rejects SKU identity mismatch in a live source grade',async()=>{const f=source();f.product.variants[0].sku='10.99';await expect(f.service.publicationSource('o','10')).rejects.toThrow('grade da Bling mudou');});
});

