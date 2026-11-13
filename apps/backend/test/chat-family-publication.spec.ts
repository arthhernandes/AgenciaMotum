import { ChatFamilyPublicationService, PublicationPlan } from '../src/chat/chat-family-publication.service';
import {replacementFingerprint} from '../src/chat/chat-family-publication.service';

describe('Resumable offers in the existing family',()=>{
  function setup(quantity=5){
    const plan:PublicationPlan={businessId:'bling',businessKey:'mottum',accountId:'ml',sellerId:'123',familyId:'456',modelMlb:'MLB1',price:249.9,warehouse:{store_id:'store',network_node_id:'node'},offer:{price:249.9,category_id:'MLB100',currency_id:'BRL',buying_mode:'buy_it_now',listing_type_id:'gold_special'},rows:[{sku:'54446.22',color:'CINZA CLARO',size:'GG',productVariantId:'v22',variant:{attributes:[{id:'COLOR',values:[{name:'CINZA CLARO'}]},{id:'SIZE',values:[{name:'GG'}]}],pictures:[{id:'picture'}]}}]};
    const job:any={status:'RUNNING',plan,rows:[{sku:'54446.22',status:'QUEUED',message:''}]};
    let stock:any=null;let item:any;const up={id:'MLBU22',user_id:123,family_id:456,...plan.rows[0].variant};
    const prisma={user:{findUnique:jest.fn().mockResolvedValue({active:true,role:'ADMIN'})},marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'ml',sellerId:'123'})},productVariant:{findUnique:jest.fn().mockResolvedValue({id:'v22',color:'CINZA CLARO',size:'GG',stock:999})},auditLog:{findMany:jest.fn().mockResolvedValue([]),findFirst:jest.fn().mockResolvedValue(null),update:jest.fn().mockResolvedValue({})},marketplaceListing:{upsert:jest.fn().mockResolvedValue({}),updateMany:jest.fn()}};
    const bling={liveStockForSku:jest.fn().mockResolvedValue({publishable:quantity,checkedAt:'2026-10-13T12:00:00Z'})};
    const client={getUserProductFamily:jest.fn().mockResolvedValue({family_id:456,user_id:123}),getFamilyUserProducts:jest.fn().mockResolvedValue({family_id:456,user_products_ids:['MLBU22']}),getUserProduct:jest.fn().mockResolvedValue(up),getWarehouses:jest.fn().mockResolvedValue([{id:'store',user_id:123,network_node_id:'node',status:'active'}]),getProductStock:jest.fn().mockImplementation(async()=>stock),initializeWarehouseStock:jest.fn().mockImplementation(async(_t,_id,body)=>{stock={data:{id:'MLBU22',user_id:123,locations:[{type:'seller_warehouse',...body}]},version:'1'};}),updateWarehouseStock:jest.fn(),searchUserProductOffers:jest.fn().mockImplementation(async()=>item?['MLB22']:[]),createUserProductOffer:jest.fn().mockImplementation(async(_t,id,body)=>{item={id:'MLB22',seller_id:123,user_product_id:id,status:'active',price:body.price,available_quantity:quantity,attributes:[]};return structuredClone(item);}),getItem:jest.fn().mockImplementation(async()=>structuredClone(item)),updateItem:jest.fn().mockImplementation(async(_t,_id,body)=>{Object.assign(item,body);return structuredClone(item);}),addFamilyUserProduct:jest.fn()};
    const auth={getValidAccessToken:jest.fn().mockResolvedValue('token')};
    const service=new ChatFamilyPublicationService(prisma as never,auth as never,client as never,bling as never);
    // Exercise the sequential engine separately from its production safety gate.
    jest.spyOn(service as any,'canGuaranteeAtomicPublication').mockReturnValue(true);
    return {service,job,client,bling,prisma,setStock:(value:any)=>stock=value,setItem:(value:any)=>item=value};
  }
  it('publishes a 48-row selection across three resumable batches without creating duplicate offers',async()=>{
    const f=setup();const client:any=f.client;const db:any=f.prisma;
    const template=structuredClone(f.job.plan.rows[0]);
    f.job.plan.publicationPolicy='PUBLISH_AVAILABLE';
    f.job.plan.rows=Array.from({length:48},(_,index)=>({...structuredClone(template),sku:'BATCH.'+index,color:'Color '+index,size:'P',productVariantId:'v'+index,variant:{attributes:[{id:'COLOR',values:[{name:'Color '+index}]},{id:'SIZE',values:[{name:'P'}]}],pictures:[{id:'picture'}]}}));
    f.job.rows=f.job.plan.rows.map((row:any)=>({sku:row.sku,status:'QUEUED',message:''}));
    const products=new Map(f.job.plan.rows.map((row:any,index:number)=>['UP'+index,{id:'UP'+index,user_id:123,family_id:456,...row.variant}]));
    const offers=new Map<string,any>();
    client.getFamilyUserProducts.mockResolvedValue({family_id:456,user_products_ids:[...products.keys()]});
    client.getUserProduct.mockImplementation(async(_token:string,id:string)=>products.get(id));
    client.getProductStock.mockImplementation(async(_token:string,id:string)=>({data:{id,user_id:123,locations:[{type:'seller_warehouse',store_id:'store',network_node_id:'node',quantity:5}]},version:'1'}));
    client.searchUserProductOffers.mockImplementation(async(_token:string,_seller:string,up:string)=>[...offers.values()].filter(item=>item.user_product_id===up).map(item=>item.id));
    client.createUserProductOffer.mockImplementation(async(_token:string,up:string,body:any)=>{const item={id:'MLB'+offers.size,seller_id:123,user_product_id:up,status:'active',available_quantity:5,price:body.price,attributes:[]};offers.set(item.id,item);return structuredClone(item);});
    client.getItem.mockImplementation(async(_token:string,id:string)=>structuredClone(offers.get(id)));
    client.updateItem.mockImplementation(async(_token:string,id:string,body:any)=>{Object.assign(offers.get(id),body);return structuredClone(offers.get(id));});
    db.productVariant.findUnique.mockImplementation(async({where}:any)=>{const row=f.job.plan.rows.find((row:any)=>row.sku===where.blingAccountId_sku.sku);return {id:row.productVariantId,color:row.color,size:row.size,stock:5};});
    await (f.service as any).run('job',f.job,'user');expect(client.createUserProductOffer).toHaveBeenCalledTimes(20);
    await (f.service as any).run('job',f.job,'user');expect(client.createUserProductOffer).toHaveBeenCalledTimes(40);
    await (f.service as any).run('job',f.job,'user');expect(client.createUserProductOffer).toHaveBeenCalledTimes(48);
    expect(f.job.status).toBe('COMPLETE');expect(offers.size).toBe(48);expect(f.job.rows.every((row:any)=>row.status==='ACTIVE')).toBe(true);
  });
  it('uses live Bling stock instead of cached stock, initializes the warehouse and verifies an active offer',async()=>{
    const {service,job,client,bling}=setup(5);await (service as any).run('job',job,'user');
    expect(bling.liveStockForSku).toHaveBeenCalledWith('bling','54446.22');
    expect(client.initializeWarehouseStock).toHaveBeenCalledWith('token','MLBU22',{store_id:'store',network_node_id:'node',quantity:5});
    expect(client.createUserProductOffer).toHaveBeenCalledTimes(1);
    expect(client.createUserProductOffer.mock.calls[0][1]).toBe('MLBU22');
    expect(client.createUserProductOffer.mock.calls[0][2]).not.toHaveProperty('available_quantity');
    expect(client.addFamilyUserProduct).not.toHaveBeenCalled();
    expect(job.status).toBe('COMPLETE');expect(job.rows[0].status).toBe('ACTIVE');
  });
  it('does not publish again when another job sent the same SKU but provider search has not indexed it',async()=>{
    const f=setup();f.prisma.auditLog.findMany.mockResolvedValue([{after:{rows:[{sku:'54446.22',offerSent:true,mlb:'MLB_OTHER'}]}}] as never);
    f.client.getItem.mockResolvedValue({id:'MLB_OTHER',seller_id:123,user_product_id:'MLBU22',status:'under_review'} as never);
    await (f.service as any).run('job',f.job,'user');
    expect(f.client.createUserProductOffer).not.toHaveBeenCalled();expect(f.job.status).toBe('WAITING_DATA');expect(f.job.rows[0].message).toContain('Outra execução');
  });
  it('reuses a verified active offer from another job even before search indexes it',async()=>{
    const f=setup();f.prisma.auditLog.findMany.mockResolvedValue([{after:{rows:[{sku:'54446.22',offerSent:true,mlb:'MLB_OTHER'}]}}] as never);
    f.setItem({id:'MLB_OTHER',seller_id:123,user_product_id:'MLBU22',status:'active',price:249.9,available_quantity:5,attributes:[{id:'SELLER_SKU',value_name:'54446.22'}]});
    f.client.searchUserProductOffers.mockResolvedValue([]);
    await (f.service as any).run('job',f.job,'user');
    expect(f.client.createUserProductOffer).not.toHaveBeenCalled();expect(f.job.status).toBe('COMPLETE');expect(f.job.rows[0].mlb).toBe('MLB_OTHER');
  });
  it.each([false,true])('ignores a closed historical offer, including a cached MLB reference (%s)',async(cached)=>{
    const f=setup();const old={id:'MLB10',seller_id:123,user_product_id:'MLBU22',status:'closed'};
    if(cached)f.job.rows[0].mlb='MLB10';
    const read=f.client.getItem.getMockImplementation()!;
    f.client.searchUserProductOffers.mockResolvedValue(['MLB10']);
    f.client.getItem.mockImplementation(async(...args:any[])=>args[1]==='MLB10'?structuredClone(old):(read as any)(...args));
    await (f.service as any).run('job',f.job,'user');
    expect(f.client.createUserProductOffer).toHaveBeenCalledTimes(1);expect(f.job.rows[0].mlb).toBe('MLB22');expect(f.job.status).toBe('COMPLETE');
    expect(f.client.updateItem.mock.calls.every(call=>call[1]!=='MLB10')).toBe(true);
  });
  it('does not recreate an offer actually sent by this job if it has since been closed',async()=>{
    const f=setup();f.job.rows[0].mlb='MLB10';f.job.rows[0].offerSent=true;
    f.client.searchUserProductOffers.mockResolvedValue(['MLB10']);f.client.getItem.mockResolvedValue({id:'MLB10',seller_id:123,user_product_id:'MLBU22',status:'closed'} as never);
    await (f.service as any).run('job',f.job,'user');
    expect(f.client.createUserProductOffer).not.toHaveBeenCalled();expect(f.job.rows[0].status).toBe('FAILED');
  });
  it.each(['under_review','inactive'])('adds an independent offer without closing the old %s offer',async(status)=>{
    const f=setup();const old={id:'MLB10',seller_id:123,user_product_id:'MLBU22',status,sub_status:['waiting_for_patch']};
    f.job.plan.rows[0].additionalOffer={upId:'MLBU22',existingIds:['MLB10']};
    const read=f.client.getItem.getMockImplementation()!;
    f.client.searchUserProductOffers.mockResolvedValue(['MLB10']);
    f.client.getItem.mockImplementation(async(...args:any[])=>args[1]==='MLB10'?structuredClone(old):(read as any)(...args));
    await (f.service as any).run('job',f.job,'user');
    expect(f.job.status).toBe('COMPLETE');expect(f.client.createUserProductOffer).toHaveBeenCalledWith('token','MLBU22',f.job.plan.offer);
    expect(f.client.updateItem.mock.calls.every(call=>call[1]!=='MLB10')).toBe(true);
    expect(old.status).toBe(status);expect(f.client.addFamilyUserProduct).not.toHaveBeenCalled();
  });
  it('refuses a new offer if a matching active offer appeared after the preview',async()=>{
    const f=setup();f.job.plan.rows[0].additionalOffer={upId:'MLBU22',existingIds:['MLB10']};
    f.client.searchUserProductOffers.mockResolvedValue(['MLB10']);f.client.getItem.mockResolvedValue({id:'MLB10',seller_id:123,user_product_id:'MLBU22',status:'active'} as never);
    await (f.service as any).run('job',f.job,'user');
    expect(f.job.rows[0].status).toBe('FAILED');expect(f.client.createUserProductOffer).not.toHaveBeenCalled();expect(f.client.updateItem).not.toHaveBeenCalled();expect(f.client.initializeWarehouseStock).not.toHaveBeenCalled();
  });
  it('does not resend an additional offer after a timeout or reuse its old moderated offer',async()=>{
    const f=setup();f.job.plan.rows[0].additionalOffer={upId:'MLBU22',existingIds:['MLB10']};
    f.client.searchUserProductOffers.mockResolvedValue(['MLB10']);f.client.getItem.mockResolvedValue({id:'MLB10',seller_id:123,user_product_id:'MLBU22',status:'under_review'} as never);
    f.client.createUserProductOffer.mockRejectedValue(Error('timeout'));
    await (f.service as any).run('job',f.job,'user');await (f.service as any).run('job',f.job,'user');
    expect(f.client.createUserProductOffer).toHaveBeenCalledTimes(1);expect(f.client.updateItem).not.toHaveBeenCalled();expect(f.job.rows[0].status).toBe('WAITING');
  });
  it('creates a replacement on the same user product only after verified closure of the approved old offer',async()=>{
    const f=setup();const old:any={id:'MLB10',seller_id:123,user_product_id:'MLBU22',status:'under_review'};
    f.job.plan.rows[0].replacementOffers=[{id:old.id,upId:'MLBU22',fingerprint:replacementFingerprint(old)}];
    const read=f.client.getItem.getMockImplementation()!,update=f.client.updateItem.getMockImplementation()!;
    f.client.searchUserProductOffers.mockResolvedValue(['MLB10']);
    f.client.getItem.mockImplementation(async(...args:any[])=>args[1]==='MLB10'?structuredClone(old):(read as any)(...args));
    f.client.updateItem.mockImplementation(async(...args:any[])=>{if(args[1]==='MLB10'){Object.assign(old,args[2]);return structuredClone(old);}return (update as any)(...args);});
    f.client.createUserProductOffer.mockImplementationOnce(async(_t,id,body)=>{expect(old.status).toBe('closed');const item={id:'MLB22',seller_id:123,user_product_id:id,status:'active',price:body.price,available_quantity:5,attributes:[{id:'SELLER_SKU',value_name:'54446.22'}]};f.setItem(item);return structuredClone(item);});
    await (f.service as any).run('job',f.job,'user');
    expect(f.job.rows[0].replacementClosed).toEqual(['MLB10']);expect(f.client.createUserProductOffer).toHaveBeenCalledTimes(1);expect(f.job.rows[0].status).toBe('ACTIVE');
  });
  it('stops a cancelled job before calling the provider and preserves already active rows',async()=>{
    const {service,job,client,prisma}=setup();job.rows.push({sku:'already',status:'ACTIVE',message:'Published'});
    prisma.auditLog.findFirst.mockResolvedValue({before:{cancelRequested:true}} as never);
    await (service as any).run('job',job,'user');
    expect(job.status).toBe('CANCELLED');expect(job.rows[1].status).toBe('ACTIVE');expect(client.getUserProductFamily).not.toHaveBeenCalled();expect(client.createUserProductOffer).not.toHaveBeenCalled();
  });
  it('stops after an in-flight request returns without pretending it was undone',async()=>{
    const {service,job,client,prisma}=setup();
    client.createUserProductOffer.mockImplementation(async()=>{prisma.auditLog.findFirst.mockResolvedValue({before:{cancelRequested:true}} as never);return {id:'MLB_NEW',seller_id:123,user_product_id:'MLBU22'} as never;});
    await (service as any).run('job',job,'user');
    expect(client.createUserProductOffer).toHaveBeenCalledTimes(1);expect(job.status).toBe('CANCELLED');expect(job.rows[0].mlb).toBe('MLB_NEW');expect(client.updateItem).not.toHaveBeenCalled();
    await (service as any).run('job',job,'user');expect(client.createUserProductOffer).toHaveBeenCalledTimes(1);
  });
  it('keeps zero-stock variants prepared and never invents stock or creates a sale offer',async()=>{
    const {service,job,client}=setup(0);await (service as any).run('job',job,'user');
    expect(job.status).toBe('WAITING_STOCK');expect(job.rows[0].status).toBe('NO_STOCK');
    expect(client.initializeWarehouseStock).not.toHaveBeenCalled();expect(client.createUserProductOffer).not.toHaveBeenCalled();
  });
  it('publishes an authorized zero-stock offer paused without fabricating inventory',async()=>{
    const {service,job,client}=setup(0);job.plan.publishWithoutStock=true;
    await (service as any).run('job',job,'user');
    expect(client.initializeWarehouseStock).toHaveBeenCalledWith('token','MLBU22',{store_id:'store',network_node_id:'node',quantity:0});
    expect(client.createUserProductOffer).toHaveBeenCalledTimes(1);expect(client.updateItem).toHaveBeenCalledWith('token','MLB22',expect.objectContaining({status:'paused'}));
    expect(job.rows[0].status).toBe('PUBLISHED_NO_STOCK');expect(job.status).toBe('WAITING_STOCK');
    expect(client.createUserProductOffer.mock.calls[0][2]).not.toHaveProperty('available_quantity');
  });
  it('activates the existing paused offer on replenishment without creating another listing',async()=>{
    const {service,job,client,setItem,setStock}=setup(4);job.plan.publishWithoutStock=true;job.rows[0].status='PUBLISHED_NO_STOCK';job.rows[0].mlb='MLB22';
    setItem({id:'MLB22',seller_id:123,user_product_id:'MLBU22',status:'paused',price:249.9,available_quantity:4,attributes:[{id:'SELLER_SKU',value_name:'54446.22'}]});
    setStock({data:{id:'MLBU22',user_id:123,locations:[{type:'seller_warehouse',store_id:'store',network_node_id:'node',quantity:4}]},version:'1'});
    await (service as any).run('job',job,'user');expect(client.createUserProductOffer).not.toHaveBeenCalled();expect(client.updateItem).toHaveBeenCalledWith('token','MLB22',{status:'active'});expect(job.rows[0].status).toBe('ACTIVE');
  });
  it('accepts a separately verified final price while monitoring a published zero-stock offer',async()=>{const {service,job,client,setItem,setStock}=setup(0);job.plan.publishWithoutStock=true;job.rows[0].status='PUBLISHED_NO_STOCK';job.rows[0].mlb='MLB22';job.rows[0].verifiedPrice=129.9;setItem({id:'MLB22',seller_id:123,user_product_id:'MLBU22',status:'paused',price:129.9,available_quantity:0,attributes:[{id:'SELLER_SKU',value_name:'54446.22'}]});setStock({data:{id:'MLBU22',user_id:123,locations:[{type:'seller_warehouse',store_id:'store',network_node_id:'node',quantity:0}]},version:'1'});await (service as any).run('job',job,'user');expect(job.rows[0].status).toBe('PUBLISHED_NO_STOCK');expect(job.status).toBe('WAITING_STOCK');expect(client.createUserProductOffer).not.toHaveBeenCalled();expect(client.updateItem).not.toHaveBeenCalled();});
  it('records verified prices with owner scoping and without issuing provider mutations',async()=>{const {service,job,prisma,client}=setup(0);(prisma.auditLog as any).findFirst=jest.fn().mockResolvedValue({id:'job',after:job});(prisma.auditLog as any).updateMany=jest.fn().mockResolvedValue({count:1});await service.acceptVerifiedPrices('job','bling','user',{'54446.22':129.9});expect((prisma.auditLog as any).findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'job',userId:'user',before:{path:['accountId'],equals:'bling'}})}));expect((prisma.auditLog as any).updateMany.mock.calls[0][0].data.after.rows[0].verifiedPrice).toBe(129.9);expect(client.updateItem).not.toHaveBeenCalled();expect(client.createUserProductOffer).not.toHaveBeenCalled();});
  it('creates a newly approved job after a known missing-chart rejection instead of returning the frozen job',async()=>{const {service,job,prisma,client}=setup();job.plan.sizeChart={id:'new-chart',rows:{gg:'row'}};(prisma.auditLog as any).findFirst=jest.fn().mockResolvedValueOnce({id:'blocked',after:{status:'WAITING_DATA',plan:job.plan}}).mockResolvedValueOnce(null);(prisma.auditLog as any).create=jest.fn().mockResolvedValue({id:'revised-job'});jest.spyOn(service,'tick').mockResolvedValue();expect(await service.enqueue(job.plan,'user')).toEqual({jobId:'revised-job'});expect((prisma.auditLog as any).create).toHaveBeenCalledTimes(1);expect(client.createUserProductOffer).not.toHaveBeenCalled();});
  it('counts a verified paused offer as published and without stock, never as active',async()=>{
    const {service,job,prisma}=setup(0);job.plan.publishWithoutStock=true;await (service as any).run('job',job,'user');
    (prisma.auditLog as any).findFirst=jest.fn().mockResolvedValue({id:'job',after:job});
    const result=await service.status('job','bling','user');expect(result.published).toBe(1);expect(result.active).toBe(0);expect(result.withoutStock).toBe(1);
  });
  it('never republishes an offer after an ambiguous timeout',async()=>{
    const {service,job,client}=setup();client.createUserProductOffer.mockRejectedValue(new Error('timeout'));
    await (service as any).run('job',job,'user');expect(job.rows[0].offerSent).toBe(true);
    await (service as any).run('job',job,'user');
    expect(client.createUserProductOffer).toHaveBeenCalledTimes(1);expect(job.status).toBe('WAITING');
  });
  it('recovers an already-created offer after a restart without duplicating it',async()=>{
    const {service,job,client,setItem}=setup();job.rows[0].offerSent=true;
    setItem({id:'MLB22',seller_id:123,user_product_id:'MLBU22',status:'active',price:249.9,available_quantity:5,attributes:[{id:'SELLER_SKU',value_name:'54446.22'}]});
    await (service as any).run('job',job,'user');expect(job.status).toBe('COMPLETE');expect(client.createUserProductOffer).not.toHaveBeenCalled();
  });
  it('respects Retry-After and resets only the request definitively rejected with 429',async()=>{
    const {service,job,client}=setup();client.createUserProductOffer.mockRejectedValue({response:{status:429,headers:{'retry-after':'120'}}});
    const before=Date.now();await (service as any).run('job',job,'user');
    expect(job.nextAt).toBeGreaterThanOrEqual(before+120_000);expect(job.rows[0].offerSent).toBe(false);expect(job.status).toBe('WAITING');
  });
  it('does not clear an ambiguous publication intent when a later read hits a rate limit',async()=>{
    const {service,job,client}=setup();job.rows[0].offerSent=true;
    client.searchUserProductOffers.mockRejectedValue({response:{status:429,headers:{'retry-after':'60'}}});
    await (service as any).run('job',job,'user');expect(job.rows[0].offerSent).toBe(true);expect(client.createUserProductOffer).not.toHaveBeenCalled();
  });
  it('waits for required size-chart data after a definite rejection without retrying the batch',async()=>{
    const {service,job,client}=setup();client.createUserProductOffer.mockRejectedValue({response:{status:400,data:{cause:[{code:'missing.fashion_grid.grid_id.values'}]}}});
    await (service as any).run('job',job,'user');
    expect(job.status).toBe('WAITING_DATA');expect(job.rows[0].status).toBe('WAITING_DATA');expect(job.rows[0].offerSent).toBe(false);
    expect(job.rows[0].message).toContain('tabela de medidas');expect(client.createUserProductOffer).toHaveBeenCalledTimes(1);
  });
  it('blocks even a fully stocked batch before any remote access under the all-or-nothing rule',async()=>{
    const {service,job,client,bling,prisma}=setup(5);jest.spyOn(service as any,'canGuaranteeAtomicPublication').mockReturnValue(false);
    await (service as any).run('job',job,'user');
    expect(job.status).toBe('WAITING_DATA');expect(job.publicationPolicy).toBe('ALL_OR_NOTHING');expect(job.blockedReason).toContain('todas ou nenhuma');
    expect(bling.liveStockForSku).not.toHaveBeenCalled();expect(client.getUserProductFamily).not.toHaveBeenCalled();expect(client.addFamilyUserProduct).not.toHaveBeenCalled();expect(client.initializeWarehouseStock).not.toHaveBeenCalled();expect(client.createUserProductOffer).not.toHaveBeenCalled();expect(client.updateItem).not.toHaveBeenCalled();
    expect(prisma.auditLog.update).toHaveBeenCalled();
  });
  it('publishes available stock only after the plan records explicit partial-publication authorization',async()=>{
    const {service,job,client}=setup(5);jest.spyOn(service as any,'canGuaranteeAtomicPublication').mockReturnValue(false);job.plan.publicationPolicy='PUBLISH_AVAILABLE';job.publicationPolicy='PUBLISH_AVAILABLE';
    await (service as any).run('job',job,'user');
    expect(job.status).toBe('COMPLETE');expect(client.createUserProductOffer).toHaveBeenCalledTimes(1);
  });
  it('does not reuse an old all-or-nothing label as permission to publish a plan',async()=>{
    const {service,job,client}=setup(5);jest.spyOn(service as any,'canGuaranteeAtomicPublication').mockReturnValue(false);job.publicationPolicy='PUBLISH_AVAILABLE';
    await (service as any).run('job',job,'user');expect(job.status).toBe('WAITING_DATA');expect(client.createUserProductOffer).not.toHaveBeenCalled();
  });
  it('associates required metadata and waits for the asynchronous provider task without publishing prematurely',async()=>{
    const {service,job,client}=setup();job.plan.sizeChart={id:'chart',rows:{gg:'chart:1'}};job.plan.rows[0].publicationAttributes=[{id:'SIZE_GRID_ID',name:'Tabela',values:[{id:null,name:'chart'}]}];
    client.getUserProductFamily.mockResolvedValue({family_id:456,user_id:123,child_attributes_ids:['COLOR','SIZE']});
    (client as any).updateFamilyVariants=jest.fn().mockResolvedValue({task_id:'task1'});(client as any).getFamilyTask=jest.fn().mockResolvedValue({status:'pending'});
    await (service as any).run('job',job,'user');expect(job.metadataTaskId).toBe('task1');expect(job.status).toBe('WAITING');expect(client.createUserProductOffer).not.toHaveBeenCalled();
    await (service as any).run('job',job,'user');expect((client as any).updateFamilyVariants).toHaveBeenCalledTimes(1);expect(client.createUserProductOffer).not.toHaveBeenCalled();
  });
  it('rejects new previews and confirmation of saved proposals while atomic publication cannot be guaranteed',async()=>{
    const {service,job,client}=setup();jest.spyOn(service as any,'canGuaranteeAtomicPublication').mockReturnValue(false);
    await expect(service.prepare({id:'bling',businessKey:'mottum'},'user',{anuncio:'MLB1',preco:249.9,fotos_modelo_confirmadas:true})).rejects.toThrow('todas ou nenhuma');
    await expect(service.enqueue(job.plan,'user')).rejects.toThrow('todas ou nenhuma');
    expect(client.createUserProductOffer).not.toHaveBeenCalled();
  });
});
