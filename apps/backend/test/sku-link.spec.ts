import { SkuLinkService } from '../src/listing-links/sku-link.service';

describe('SKU correction workflow', () => {
  it('leaves an explicitly skipped closed offer untouched without planning or executing updates',async()=>{
    const f=make();(f.source.item as any).status='closed';
    const skipped=[{mlb:'MLB123',variationId:'10'}];
    const preview=await f.service.preview('bling1','user1',{reference:'MLB123',parentSku:'54446',manual:true,skipped});
    expect(preview.rows).toEqual([]);expect(preview.skipped).toEqual(skipped);expect(f.market.prepareCatalogSkuCorrection).not.toHaveBeenCalled();
    const result=await f.service.confirm('bling1','user1',preview.id);
    expect(result).toMatchObject({success:true,linked:0,skipped:1});expect(f.market.execute).not.toHaveBeenCalled();expect(f.market.saveLocal).not.toHaveBeenCalled();expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('passes skipped variations to the marketplace plan while preserving the other automatic matches',async()=>{
    const f=make();f.source.item.variations.push({...f.source.item.variations[0],id:11,attribute_combinations:[{id:'COLOR',value_name:'Branco'},{id:'SIZE',value_name:'G'}]});
    const skipped=[{mlb:'MLB123',variationId:'11'}];const preview=await f.service.preview('bling1','user1',{reference:'MLB123',parentSku:'54446',skipped});
    expect(preview.rows.map(row=>row.variationId)).toEqual(['10']);expect(f.market.prepareCatalogSkuCorrection.mock.calls[0][5]).toEqual(skipped);
  });
  it('rejects skipped references outside the selected listing and conflicting choices',async()=>{
    const f=make();await expect(f.service.preview('bling1','user1',{reference:'MLB123',parentSku:'54446',skipped:[{mlb:'MLB999',variationId:'10'}]})).rejects.toThrow('não pertence');
    await expect(f.service.preview('bling1','user1',{reference:'MLB123',parentSku:'54446',skipped:[{mlb:'MLB123',variationId:'10'}],choices:[{mlb:'MLB123',variationId:'10',sku:'54446.1'}]})).rejects.toThrow('ao mesmo tempo');
    expect(f.market.execute).not.toHaveBeenCalled();
  });
  it('automatically matches across both parents and requests manual choices for ambiguous matches',async()=>{
    const f=make();const second={id:'p2',sku:'other',title:'Linha 2',variants:[{id:'pv2',sku:'other.1',color:'Azul',size:'G'}]};
    f.prisma.product.findFirst.mockImplementation(({where}:any)=>Promise.resolve(where.sku==='other'?second:f.product));
    f.source.item.variations.push({...f.source.item.variations[0],id:11,attribute_combinations:[{id:'COLOR',value_name:'Azul'},{id:'SIZE',value_name:'G'}]});
    const dto={reference:'MLB123',parentSku:'54446',parentSkus:['other']};
    const result=await f.service.preview('bling1','user1',dto);expect(result.rows.map(row=>[row.sku,row.parentSku])).toEqual([['54446.1','54446'],['other.1','other']]);
    second.variants.push({id:'pv3',sku:'other.2',color:'Verde escuro',size:'P'});
    await expect(f.service.preview('bling1','user1',dto)).rejects.toMatchObject({response:{code:'SKU_MANUAL_SELECTION_REQUIRED',options:expect.arrayContaining([expect.objectContaining({sku:'other.2',parentSku:'other'})])}});
    expect(f.market.execute).not.toHaveBeenCalled();
  });
  it('returns manual options from both parents with their origin and no automatic selections',async()=>{
    const f=make();const second={id:'p2',sku:'other',title:'Linha 2',variants:[{id:'pv2',sku:'other.1',color:'Azul',size:'G'}]};
    f.prisma.product.findFirst.mockImplementation(({where}:any)=>Promise.resolve(where.sku==='other'?second:f.product));
    const result=await f.service.manualOptions('bling1','user1',{reference:'MLB123',parentSku:'54446',parentSkus:['other']});
    expect(result.options.map(row=>[row.parentSku,row.sku])).toEqual([['54446','54446.1'],['other','other.1']]);
    expect((result.rows[0] as any).sku).toBeUndefined();expect(f.market.execute).not.toHaveBeenCalled();
  });
  it('links different sizes to their actual products across two explicitly selected parents',async()=>{
    const f=make();
    const second={id:'p2',sku:'other',title:'Outra linha',variants:[{id:'pv2',sku:'other.1',color:'Azul',size:'G'}]};
    f.prisma.product.findFirst.mockImplementation(({where}:any)=>Promise.resolve(where.sku==='other'?second:f.product));
    f.source.item.variations.push({...f.source.item.variations[0],id:11,attributes:[{id:'SELLER_SKU',value_name:'wrong2'}],attribute_combinations:[{id:'COLOR',value_name:'Azul'},{id:'SIZE',value_name:'G'}]});
    await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123',manual:true,choices:[{mlb:'MLB123',variationId:'10',sku:'54446.1'},{mlb:'MLB123',variationId:'11',sku:'other.1',parentSku:'other'}]});
    expect(f.getSaved().parentSkus).toEqual(['54446','other']);expect(f.getSaved().links.map((row:any)=>row.sku)).toEqual(['54446.1','other.1']);
    f.market.execute.mockImplementation(async()=>{f.source.item.variations[0].attributes[0].value_name='54446.1';f.source.item.variations[1].attributes[0].value_name='other.1';return {success:true,message:'OK'};});
    f.prisma.marketplaceListing.findUnique.mockResolvedValue({id:'listing',variants:[{id:'lv1',variationId:'10'},{id:'lv2',variationId:'11'}]});
    const tx={marketplaceListing:{update:jest.fn()},marketplaceListingVariant:{update:jest.fn()},listingProductLink:{findMany:jest.fn().mockResolvedValue([]),deleteMany:jest.fn(),create:jest.fn().mockResolvedValue({id:'link'})},auditLog:{create:jest.fn()}};
    f.prisma.$transaction.mockImplementation((callback:any)=>callback(tx));
    const result=await f.service.confirm('bling1','user1',f.getSaved().id);expect(result.success).toBe(true);expect(result.linked).toBe(2);
    expect(tx.listingProductLink.create.mock.calls.map((call:any)=>[call[0].data.productId,call[0].data.productVariantId])).toEqual([['p1','pv1'],['p2','pv2']]);
  });
  it('loads manual options without matching, planning, or executing any changes',async()=>{
    const f=make();const result=await f.service.manualOptions('bling1','user1',{parentSku:'54446',reference:'MLB123'});
    expect(result.rows[0]).toMatchObject({mlb:'MLB123',variationId:'10',before:'wrong'});
    expect((result.rows[0] as any).sku).toBeUndefined();expect(result.options[0].sku).toBe('54446.1');
    expect(f.market.prepareCatalogSkuCorrection).not.toHaveBeenCalled();expect(f.market.execute).not.toHaveBeenCalled();expect(f.pending.save).not.toHaveBeenCalled();
  });
  it('never fills a missing manual choice automatically even when the size and color match',async()=>{
    const f=make();await expect(f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123',manual:true,choices:[]})).rejects.toThrow('Informe manualmente');
    expect(f.pending.save).not.toHaveBeenCalled();expect(f.market.prepareCatalogSkuCorrection).not.toHaveBeenCalled();
  });
  it('honors a manually entered different color instead of the automatic match',async()=>{
    const f=make();f.product.variants.push({...f.product.variants[0],id:'pv2',sku:'54446.2',color:'Azul'});
    const result=await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123',manual:true,choices:[{mlb:'MLB123',variationId:'10',sku:'54446.2'}]});
    expect(result.rows[0].sku).toBe('54446.2');expect(f.getSaved().choices[0].sku).toBe('54446.2');expect(f.market.execute).not.toHaveBeenCalled();
  });
  it('automatically matches khaki shoes labelled with the BR size suffix',async()=>{
    const f=make();f.product.variants[0].color='Caqui';f.product.variants[0].size='42';
    f.source.item.variations[0].attribute_combinations=[{id:'COLOR',value_name:'Cáqui'},{id:'SIZE',value_name:'42 BR'}];
    const result=await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'});
    expect(result.rows[0]).toMatchObject({sku:'54446.1',color:'Cáqui',size:'42 BR'});
    expect(f.market.execute).not.toHaveBeenCalled();
  });
  it('preserves parent SKU punctuation and child SKUs in the selected store',async()=>{
    const f=make();await f.service.preview('bling1','user1',{parentSku:' 54446. ',reference:'MLB123'});
    expect(f.prisma.product.findFirst.mock.calls[0][0].where).toEqual({blingAccountId:'bling1',sku:'54446.'});
    expect(f.getSaved().parentSku).toBe('54446.');expect(f.getSaved().rows[0].sku).toBe('54446.1');
    expect(f.market.execute).not.toHaveBeenCalled();
  });
  it('reads the explicit clothing-set size and array value format before automatic matching',async()=>{const f=make();const variant:any=f.source.item.variations[0];variant.attribute_combinations=[{id:'COLOR',values:[{name:'Verde escuro'}]},{id:'CLOTHING_LOT_SIZE',values:[{name:'P'}]}];const preview=await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'});expect(preview.rows[0]).toMatchObject({size:'P',color:'Verde escuro',sku:'54446.1'});expect(f.market.execute).not.toHaveBeenCalled();});
  it('permits explicit manual selection when the marketplace size is missing but does not guess automatically',async()=>{const f=make();f.source.item.variations[0].attribute_combinations.splice(1,1);await expect(f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'})).rejects.toThrow('Escolha a variação');await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123',choices:[{mlb:'MLB123',variationId:'10',sku:'54446.1'}]});expect(f.getSaved().links[0]).toMatchObject({size:'',sku:'54446.1'});expect(f.market.prepareCatalogSkuCorrection).toHaveBeenCalledTimes(1);});
  it('rejects a known incompatible clothing-set size even for manual choices',async()=>{const f=make();const variant:any=f.source.item.variations[0];variant.attribute_combinations[1]={id:'CLOTHING_LOT_SIZE',value_name:'GG'};await expect(f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123',choices:[{mlb:'MLB123',variationId:'10',sku:'54446.1'}]})).rejects.toThrow('Tamanho incompatível');expect(f.pending.save).not.toHaveBeenCalled();});
  it('persists a confirmed manual link with no source size after verifying the corrected SKU',async()=>{const f=make();f.source.item.variations[0].attribute_combinations.splice(1,1);await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123',choices:[{mlb:'MLB123',variationId:'10',sku:'54446.1'}]});f.market.execute.mockImplementation(async()=>{f.source.item.variations[0].attributes[0].value_name='54446.1';return {success:true,message:'Concluído'};});f.prisma.marketplaceListing.findUnique.mockResolvedValue({id:'l1',variants:[{id:'lv1',variationId:'10'}]});const tx={marketplaceListing:{update:jest.fn()},marketplaceListingVariant:{update:jest.fn()},listingProductLink:{findMany:jest.fn().mockResolvedValue([]),deleteMany:jest.fn(),create:jest.fn().mockResolvedValue({id:'link1'})},auditLog:{create:jest.fn()}};f.prisma.$transaction.mockImplementation((callback:any)=>callback(tx));const result=await f.service.confirm('bling1','user1',f.getSaved().id);expect(result.linked).toBe(1);expect(result.linkedItems[0].size).toBe('');});
  it('automatically matches inverted Bling grade labels before preparing a correction',async()=>{
    const f=make();f.product.variants[0].color='G';f.product.variants[0].size='MARINHO';
    f.source.item.variations[0].attribute_combinations[0].value_name='Marinho';
    f.source.item.variations[0].attribute_combinations[1].value_name='G';
    const result=await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'});
    expect(result.rows[0]).toMatchObject({sku:'54446.1',color:'Marinho',size:'G'});
    expect(f.getSaved().rows).toEqual([{sku:'54446.1',cor:'MARINHO',tamanho:'G'}]);
    expect(f.market.execute).not.toHaveBeenCalled();
  });
  it('blocks a manual XXG choice for an XL/GG listing before any write',async()=>{
    const f=make();f.product.variants[0].size='XXG';
    f.source.item.variations[0].attribute_combinations[1].value_name='XL/GG';
    await expect(f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123',choices:[{mlb:'MLB123',variationId:'10',sku:'54446.1'}]})).rejects.toThrow('Tamanho incompatível');
    expect(f.pending.save).not.toHaveBeenCalled();expect(f.market.prepareCatalogSkuCorrection).not.toHaveBeenCalled();
  });
  const make = () => {
    const variant = {id:'pv1',sku:'54446.1',color:'Verde escuro',size:'P'};
    const product = {id:'p1',sku:'54446',title:'Camisa',variants:[variant]};
    const source = {account:{id:'ml1'},item:{id:'MLB123',attributes:[],variations:[{id:10,attributes:[{id:'SELLER_SKU',value_name:'wrong'}],attribute_combinations:[{id:'COLOR',value_name:'Verde-escuro'},{id:'SIZE',value_name:'S/P'}]}]}};
    const prisma:any = {marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'bling1',businessKey:'mottum'})},product:{findFirst:jest.fn().mockResolvedValue(product)},marketplaceListing:{findUnique:jest.fn()},$transaction:jest.fn()};
    const market:any = {authorizeFiscal:jest.fn(),saveLocal:jest.fn(),fiscalSources:jest.fn().mockResolvedValue([source]),prepareCatalogSkuCorrection:jest.fn().mockResolvedValue({kind:'update',targets:[]}),execute:jest.fn().mockResolvedValue({success:false,message:'Recusado'})};
    let saved:any;
    const pending:any = {save:jest.fn(async (value:any)=>{saved=value;}),load:jest.fn(async()=>saved),claim:jest.fn()};
    const service = new SkuLinkService(prisma,market,pending);
    return {service,prisma,market,pending,product,source,getSaved:()=>saved};
  };
  it('prepares a live preview without writing to the marketplace or creating links', async()=>{
    const f=make();const result=await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'});
    expect(result.rows[0]).toMatchObject({sku:'54446.1',before:'wrong',variationId:'10'});
    expect(f.market.execute).not.toHaveBeenCalled();expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.prisma.product.findFirst.mock.calls[0][0].where).toEqual({blingAccountId:'bling1',sku:'54446'});
  });
  it('automatically prepares a link for Preta versus Preto and P versus S/P',async()=>{
    const f=make();f.product.variants[0].color='Preta';f.source.item.variations[0].attribute_combinations[0].value_name='Preto';
    const result=await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'});
    expect(result.rows[0]).toMatchObject({sku:'54446.1',color:'Preto',size:'S/P'});
    expect(f.getSaved().choices).toEqual([]);
  });
  it('rejects unavailable account context',async()=>{
    const f=make();f.prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
    await expect(f.service.preview('other','user1',{parentSku:'54446',reference:'MLB123'})).rejects.toThrow('Selecione');
    expect(f.market.fiscalSources).not.toHaveBeenCalled();
  });
  it('blocks ambiguous matches before persisting a proposal',async()=>{
    const f=make();f.product.variants.push({...f.product.variants[0],id:'pv2',sku:'54446.2'});
    await expect(f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'})).rejects.toMatchObject({response:{code:'SKU_MANUAL_SELECTION_REQUIRED',rows:[{mlb:'MLB123',variationId:'10',color:'Verde-escuro',size:'S/P',before:'wrong',sku:''}]}});
    expect(f.pending.save).not.toHaveBeenCalled();
  });
  it('accepts an explicit SKU choice when the marketplace color differs',async()=>{
    const f=make();f.source.item.variations[0].attribute_combinations[0].value_name='Água';
    const choices=[{mlb:'MLB123',variationId:'10',sku:'54446.1'}];
    const result=await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123',choices});
    expect(result.rows[0]).toMatchObject({sku:'54446.1',color:'Água'});
    expect(f.market.prepareCatalogSkuCorrection.mock.calls[0][4]).toEqual(choices);
    expect(f.getSaved().choices).toEqual(choices);
  });
  it('rejects a manual SKU outside the selected parent catalog',async()=>{
    const f=make();await expect(f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123',choices:[{mlb:'MLB123',variationId:'10',sku:'OTHER.1'}]})).rejects.toThrow('Seleção manual inválida');
    expect(f.market.prepareCatalogSkuCorrection).not.toHaveBeenCalled();
  });
  it('rejects a selection belonging to another advertisement',async()=>{
    const f=make();await expect(f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123',choices:[{mlb:'MLB999',variationId:'10',sku:'54446.1'}]})).rejects.toThrow('não pertence');
    expect(f.pending.save).not.toHaveBeenCalled();
  });
  it('confirms an explicit color override without replacing it with automatic matching',async()=>{
    const f=make();f.source.item.variations[0].attribute_combinations[0].value_name='Água';
    await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123',choices:[{mlb:'MLB123',variationId:'10',sku:'54446.1'}]});
    f.market.execute.mockImplementation(async()=>{f.source.item.variations[0].attributes[0].value_name='54446.1';return {success:true,message:'Concluído'};});
    f.prisma.marketplaceListing.findUnique.mockResolvedValue({id:'l1',variants:[{id:'lv1',variationId:'10'}]});
    const tx={marketplaceListing:{update:jest.fn()},marketplaceListingVariant:{update:jest.fn()},listingProductLink:{findMany:jest.fn().mockResolvedValue([]),deleteMany:jest.fn(),create:jest.fn().mockResolvedValue({id:'link1'})},auditLog:{create:jest.fn()}};
    f.prisma.$transaction.mockImplementation((callback:any)=>callback(tx));
    expect((await f.service.confirm('bling1','user1',f.getSaved().id)).linked).toBe(1);
  });
  it('rejects stale catalog before any marketplace write',async()=>{
    const f=make();await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'});f.product.variants[0].size='G';
    await expect(f.service.confirm('bling1','user1',f.getSaved().id)).rejects.toThrow('catálogo mudou');
    expect(f.market.execute).not.toHaveBeenCalled();
  });
  it('rejects changed live attributes before claiming or executing',async()=>{
    const f=make();await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'});f.source.item.variations[0].attribute_combinations[1].value_name='G';
    await expect(f.service.confirm('bling1','user1',f.getSaved().id)).rejects.toThrow('mudaram');
    expect(f.pending.claim).not.toHaveBeenCalled();expect(f.market.execute).not.toHaveBeenCalled();
  });
  it('does not create a link when the remote SKU was not corrected',async()=>{
    const f=make();await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'});
    f.prisma.marketplaceListing.findUnique.mockResolvedValue({id:'l1',variants:[{id:'lv1',variationId:'10'}]});
    const result=await f.service.confirm('bling1','user1',f.getSaved().id);
    expect(result.success).toBe(false);expect(result.linked).toBe(0);expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(result.linkedItems).toEqual([]);
    expect(f.market.saveLocal).toHaveBeenCalledWith(f.source.account,f.source.item);
  });
  it('accepts JSONB records with reordered object keys without reporting a stale catalog',async()=>{
    const f=make();await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'});
    const reorder=(value:any):any=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,reorder(value[key])])):value;
    f.pending.load.mockResolvedValue(reorder(f.getSaved()));
    f.prisma.marketplaceListing.findUnique.mockResolvedValue(null);
    await f.service.confirm('bling1','user1',f.getSaved().id);
    expect(f.market.execute).toHaveBeenCalledTimes(1);
  });
  it('links only after the remote correction is read back successfully',async()=>{
    const f=make();await f.service.preview('bling1','user1',{parentSku:'54446',reference:'MLB123'});
    f.market.execute.mockImplementation(async()=>{f.source.item.variations[0].attributes[0].value_name='54446.1';return {success:true,message:'Concluído'};});
    f.prisma.marketplaceListing.findUnique.mockResolvedValue({id:'l1',variants:[{id:'lv1',variationId:'10'}]});
    const tx={marketplaceListing:{update:jest.fn()},marketplaceListingVariant:{update:jest.fn()},listingProductLink:{findMany:jest.fn().mockResolvedValue([]),deleteMany:jest.fn(),create:jest.fn().mockResolvedValue({id:'link1'})},auditLog:{create:jest.fn()}};
    f.prisma.$transaction.mockImplementation((callback:any)=>callback(tx));
    const result=await f.service.confirm('bling1','user1',f.getSaved().id);
    expect(result.success).toBe(true);expect(result.linked).toBe(1);
    expect(result.linkedItems).toEqual([{mlb:'MLB123',variationId:'10',color:'Verde-escuro',size:'S/P',before:'wrong',sku:'54446.1'}]);
    expect(f.market.saveLocal).toHaveBeenCalledWith(f.source.account,f.source.item);
    expect(tx.listingProductLink.create.mock.calls[0][0].data).toMatchObject({listingId:'l1',listingVariantId:'lv1',productId:'p1',productVariantId:'pv1',manuallyConfirmed:true});
  });
});
