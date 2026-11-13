import { ChatFamilyVariants } from '../src/chat/chat-family-variants';

describe('Variants in an existing family without publishing listings', () => {
  const business={id:'bling',businessKey:'mottum'};
  function setup() {
    const account={id:'ml',name:'Motum',sellerId:'123'};
    const family={family_id:456,user_id:123,site_id:'MLB',family_name:'Polo Levis',domain_id:'MLB-SHIRTS',child_attributes_ids:['COLOR','SIZE','FABRIC_DESIGN'],attributes:[]};
    const model={id:'MLBU1',family_id:456,user_id:123,attributes:[{id:'COLOR',values:[{name:'Azul Royal'}]},{id:'SIZE',values:[{name:'GG'}]},{id:'FABRIC_DESIGN',values:[{id:'42',name:'Piquet'}]}],pictures:[{id:'999-MLB123_012026'}]};
    const rows=[{id:'v1',productId:'p',sku:'54446.17',color:'Azul Royal',size:'GG'},{id:'v2',productId:'p',sku:'54446.2',color:'Amarelo',size:'GG'},{id:'v22',productId:'p',sku:'54446.22',color:'CINZA CLARO',size:'GG'}];
    const products:any[]=[model];
    const prisma={productVariant:{findUnique:jest.fn().mockImplementation(async a=>rows.find(r=>r.sku===a.where.blingAccountId_sku.sku)??null)},marketplaceAccount:{findFirst:jest.fn().mockResolvedValue(account)},auditLog:{create:jest.fn().mockResolvedValue({id:'audit'}),update:jest.fn().mockResolvedValue({})}};
    const client={getUserProduct:jest.fn().mockImplementation(async (_t,id)=>products.find(p=>p.id===id)),getUserProductFamily:jest.fn().mockImplementation(async()=>structuredClone(family)),getFamilyUserProducts:jest.fn().mockImplementation(async()=>({family_id:456,user_products_ids:products.map(p=>p.id)})),addFamilyUserProduct:jest.fn().mockImplementation(async (_t,_f,body)=>{const created={id:'MLBU'+(products.length+1),family_id:456,user_id:123,...structuredClone(body)};products.push(created);return created;}),createItem:jest.fn(),validateItem:jest.fn(),updateItem:jest.fn()};
    const service=new ChatFamilyVariants(prisma as never,{getValidAccessToken:jest.fn().mockResolvedValue('token')} as never,client as never);
    const source={account,token:'token',item:{id:'MLB1',user_product_id:'MLBU1',attributes:[{id:'SELLER_SKU',value_name:'54446.17'}]}};
    return {service,client,prisma,family,products,source,rows};
  }
  it('obtains color and size by SKU and prepares no price, stock, listing or size chart', async()=>{
    const {service,source,client}=setup();
    const plan=await service.prepare(business,source,[{sku:'54446.2',fotos:null},{sku:'54446.22',fotos:null}]);
    expect(plan.kind).toBe('family_variants');
    expect(plan.targets[0].body.attributes).toContainEqual({id:'COLOR',values:[{id:null,name:'Amarelo'}]});
    expect(plan.targets[1].body.attributes).toContainEqual({id:'COLOR',values:[{id:null,name:'Cinza Claro'}]});
    expect(plan.targets[1].body.attributes).toContainEqual({id:'FABRIC_DESIGN',values:[{id:'42',name:'Piquet'}]});
    for(const t of plan.targets) expect(Object.keys(t.body).sort()).toEqual(['attributes','pictures']);
    expect(plan.targets[0].preview.notes.join(' ')).toContain('Fotos herdadas');
    expect(client.addFamilyUserProduct).not.toHaveBeenCalled();
    expect(client.validateItem).not.toHaveBeenCalled();
  });
  it('creates and verifies each variant only on confirmation, preserving the family', async()=>{
    const {service,source,client,prisma}=setup();
    const plan=await service.prepare(business,source,[{sku:'54446.2'},{sku:'54446.22'}]);
    const result=await service.execute(plan,business,'user');
    expect(result.success).toBe(true);
    expect(client.addFamilyUserProduct).toHaveBeenCalledTimes(2);
    expect(client.addFamilyUserProduct.mock.calls[0][1]).toBe('456');
    expect(client.createItem).not.toHaveBeenCalled();expect(client.updateItem).not.toHaveBeenCalled();
    expect(prisma.auditLog.update.mock.calls[0][0].data.after.sku).toBe('54446.2');
    expect(result.message).toContain('Nenhum anúncio foi publicado');
  });
  it('blocks catalog variants from another product or account',async()=>{
    const {service,source,rows,prisma}=setup();rows[1].productId='other';
    await expect(service.prepare(business,source,[{sku:'54446.2'}])).rejects.toThrow('produto Bling deste pai');
    expect(prisma.productVariant.findUnique).toHaveBeenCalledWith({where:{blingAccountId_sku:{blingAccountId:'bling',sku:'54446.2'}}});
  });
  it('blocks existing variants including products without any listing',async()=>{
    const {service,source,products}=setup();products.push({...products[0],id:'MLBU9',attributes:[{id:'COLOR',values:[{name:'Cinza Claro'}]},{id:'SIZE',values:[{name:'GG'}]},{id:'FABRIC_DESIGN',values:[{id:'42',name:'Piquet'}]}]});
    await expect(service.prepare(business,source,[{sku:'54446.22'}])).rejects.toThrow('já existe');
  });
  it('preflights the entire batch and sends nothing if the second variant already exists',async()=>{
    const {service,source,products,client}=setup();
    const plan=await service.prepare(business,source,[{sku:'54446.2'},{sku:'54446.22'}]);
    products.push({...products[0],id:'MLBU9',...plan.targets[1].body});
    expect((await service.execute(plan,business,'user')).status).toBe('FAILED');
    expect(client.addFamilyUserProduct).not.toHaveBeenCalled();
  });
  it('blocks changed parent attributes or changed catalog color before creating variants',async()=>{
    const {service,source,family,client,rows}=setup();
    const plan=await service.prepare(business,source,[{sku:'54446.22'}]);family.family_name='Outro pai';
    expect((await service.execute(plan,business,'user')).success).toBe(false);
    expect(client.addFamilyUserProduct).not.toHaveBeenCalled();family.family_name='Polo Levis';rows[2].color='Azul Royal';
    expect((await service.execute(plan,business,'user')).success).toBe(false);
    expect(client.addFamilyUserProduct).not.toHaveBeenCalled();
  });
  it('stops the batch after an uncertain write and keeps a durable audit record',async()=>{
    const {service,source,client,prisma}=setup();
    const plan=await service.prepare(business,source,[{sku:'54446.2'},{sku:'54446.22'}]);
    client.addFamilyUserProduct.mockRejectedValue(new Error('timeout'));
    const result=await service.execute(plan,business,'user');
    expect(result.status).toBe('UNVERIFIED');
    expect(client.addFamilyUserProduct).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.update.mock.calls[0][0].data.after.status).toBe('UNVERIFIED');
    expect(result.results[1].message).toContain('Não enviada');
  });
});

