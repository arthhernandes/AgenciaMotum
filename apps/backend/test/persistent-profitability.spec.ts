import { ProfitabilityService } from '../src/reports/profitability.service';
import { PersistentSnapshots } from '../src/reports/persistent-snapshots';
import { assertRoutePermissions } from '../src/auth/permissions';
describe('Database-only profitability',()=>{
  it('classifies an unlinked historic offer through its uniquely linked family in the map',async()=>{
    const f=setup();await archive(f,{rows:[{...row,sku:'old-sku'}]});
    f.prisma.product.findMany.mockResolvedValue([{sku:'58887',title:'Polo correta',variants:[{sku:'58887.1'}]}]);
    f.prisma.marketplaceListing.findMany.mockImplementation(async({where}:any)=>where.marketplaceAccountId?[{itemId:row.itemId,marketplaceAccountId:'meli',rawData:{family_id:123},links:[]}]:[{itemId:'MLB2',marketplaceAccountId:'meli',rawData:{family_id:123},links:[{product:{sku:'58887',blingAccountId:'bling'}}]}]);
    expect((await f.service.page(f.query)).rows[0]).toMatchObject({parentSku:'58887',parentTitle:'Polo correta',sku:'old-sku',revenue:200});
  });
  it('does not guess the parent of an unlinked historic offer in a family shared by products',async()=>{
    const f=setup();await archive(f,{rows:[{...row,sku:'old-sku'}]});
    f.prisma.product.findMany.mockResolvedValue([{sku:'5484-LINHA1',title:'A',variants:[]},{sku:'5484-LINHA2',title:'B',variants:[]}]);
    f.prisma.marketplaceListing.findMany.mockImplementation(async({where}:any)=>where.marketplaceAccountId?[{itemId:row.itemId,marketplaceAccountId:'meli',rawData:{family_id:123},links:[]}]:[{itemId:'MLB2',marketplaceAccountId:'meli',rawData:{family_id:123},links:[{product:{sku:'5484-LINHA1',blingAccountId:'bling'}},{product:{sku:'5484-LINHA2',blingAccountId:'bling'}}]}]);
    expect((await f.service.page(f.query)).rows[0].parentSku).toBeNull();
  });
  it('uses the exact variation link from the map when an archived seller SKU is malformed',async()=>{
    const f=setup();await archive(f,{rows:[{...row,sku:'5484.00555484.0055',variationId:11}]});
    f.prisma.product.findMany.mockResolvedValue([{sku:'5484-LINHA1',title:'Polo Linha A',variants:[{sku:'5484.0055'}]},{sku:'5484-LINHA2',title:'Polo Linha B',variants:[]}]);
    f.prisma.marketplaceListing.findMany.mockResolvedValue([{itemId:row.itemId,title:'Polo',rawData:{family_id:123},links:[{product:{sku:'5484-LINHA2',blingAccountId:'bling'},listingVariant:{variationId:'12'}},{product:{sku:'5484-LINHA1',blingAccountId:'bling'},listingVariant:{variationId:'11'}}]}]);
    const result=await f.service.page(f.query);
    expect(result.rows[0]).toMatchObject({parentSku:'5484-LINHA1',parentTitle:'Polo Linha A',sku:'5484.00555484.0055',revenue:200});
  });
  it('preserves separate Bling LINHA parents exactly as in the links map',async()=>{
    const f=setup();
    f.prisma.product.findMany.mockResolvedValue([{sku:'5484-LINHA1',title:'Polo Linha A',variants:[{sku:'5484.01'}]},{sku:'5484-LINHA2',title:'Polo Linha B',variants:[{sku:'5484.124'}]}]);
    const parents=await (f.service as any).parents('business','bling');
    expect(parents.get('5484.01')).toMatchObject({parentSku:'5484-LINHA1',parentTitle:'Polo Linha A'});
    expect(parents.get('5484.124')).toMatchObject({parentSku:'5484-LINHA2',parentTitle:'Polo Linha B'});
    expect(parents.has('5484')).toBe(false);
    const where=f.prisma.product.findMany.mock.calls[0][0].where;
    expect(where.blingAccountId).toEqual({in:['bling']});expect(where.AND[0]).toEqual({sku:{not:{contains:'.'}}});
  });
  it('returns parent listing family identity from the selected marketplace account',async()=>{
    const f=setup();await archive(f);
    f.prisma.marketplaceListing.findMany.mockResolvedValue([{itemId:row.itemId,title:'Polo Marinho',rawData:{family_id:123,family_name:'Polo original'}}]);
    const report=await f.service.page(f.query);
    expect(report.rows[0]).toMatchObject({parentListingId:'123',parentListingTitle:'Polo original'});
    expect(f.prisma.marketplaceListing.findMany.mock.calls.find((call:any[])=>call[0].where.marketplaceAccountId)?.[0].where.marketplaceAccountId).toBe('meli');
  });
  function setup(){
    const records=new Map<string,any>(),key=(value:any)=>[value.marketplaceAccountId,value.category,value.key].join('/');
    const prisma:any={marketplaceListing:{findMany:jest.fn(async()=>[])},product:{findMany:jest.fn(async()=>[])},marketplaceAccount:{findMany:jest.fn(async()=>[{id:'bling'}]),findFirst:jest.fn(async({where}:any)=>({id:where.id,businessKey:where.id,marketplace:'MERCADO_LIVRE'})),findUnique:jest.fn(async({where}:any)=>({id:where.id,sellerId:where.id==='other'?'8':'7'}))},integrationSnapshot:{
      findMany:jest.fn(async({where}:any)=>[...records.values()].filter(r=>r.marketplaceAccountId===where.marketplaceAccountId&&r.category===where.category&&(!where.key.startsWith||r.key.startsWith(where.key.startsWith))&&(!where.key.gte||r.key>=where.key.gte)&&(!where.key.lte||r.key<=where.key.lte)&&(!where.AND||where.AND.every((clause:any)=>clause.payload.gte?r.payload.orderDate>=clause.payload.gte:r.payload.orderDate<=clause.payload.lte))&&(!where.fetchedAt||r.fetchedAt>=where.fetchedAt.gte)).sort((a,b)=>b.fetchedAt-a.fetchedAt)),
      findUnique:jest.fn(async({where}:any)=>records.get(key(where.marketplaceAccountId_category_key))??null),
      upsert:jest.fn(async({where,create,update}:any)=>{const k=key(where.marketplaceAccountId_category_key),data=records.has(k)?{...records.get(k),...update}:create;records.set(k,data);return data;})
    }};
    const row={orderId:'1',itemIndex:0,itemId:'MLB1',revenue:200,commission:20,sellerShipping:6.67,fiscalCost:100,profitBeforeTaxes:73.33,issues:[]};
    const engine={page:jest.fn().mockResolvedValue({rows:[row],errors:[],incomplete:false,total:1,nextOffset:null,processedOrders:1,offset:0,checkedAt:new Date().toISOString()}),advertising:jest.fn().mockResolvedValue({results:[{itemId:'MLB1',cost:0,source:'Product Ads'}],checkedAt:new Date().toISOString()})};
    const service=new ProfitabilityService(prisma,{} as any);jest.spyOn(service as any,'engine').mockResolvedValue(engine);
    const query:any={marketplaceAccountId:'meli',dateFrom:'2026-10-01',dateTo:'2026-10-02',offset:0,limit:10,refresh:false};
    return {prisma,records,engine,service,query};
  }

  const row={orderId:'1',itemIndex:0,itemId:'MLB1',sku:'5484.01',title:'Polo Marinho XXXG',revenue:200,commission:20,sellerShipping:6.67,fiscalCost:100,profitBeforeTaxes:73.33,issues:[]};
  async function archive(f:any, overrides:any={}){await new PersistentSnapshots(f.prisma).put('meli','ORDER_HISTORY','v1|7|1',{orderId:'1',orderDate:'2026-10-01',status:'paid',rows:[row],...overrides});}
  it.each([{refresh:true,cachedOnly:false},{refresh:false,cachedOnly:false},{cachedOnly:true}])('never queries providers even with legacy flags %j',async flags=>{
    const f=setup();await archive(f);const data=await f.service.page({...f.query,...flags});expect(data.fromDatabase).toBe(true);expect(data.rows).toHaveLength(1);expect(f.engine.page).not.toHaveBeenCalled();expect(f.prisma.integrationSnapshot.upsert).toHaveBeenCalledTimes(1);
  });
  it('returns an empty database result without fetching missing orders',async()=>{const f=setup();expect(await f.service.page({...f.query,refresh:true})).toMatchObject({cacheMiss:true,rows:[],fromDatabase:true,nextOffset:null});expect(f.engine.page).not.toHaveBeenCalled();});
  it('restores orders after service recreation and recalculates taxes locally',async()=>{const f=setup();await archive(f);const service=new ProfitabilityService(f.prisma,{getValidAccessToken:()=>{throw Error('External read forbidden');}} as any);expect((await service.page({...f.query,taxRate:7})).rows[0].netProfit).toBe(59.33);});
  it('isolates accounts and periods',async()=>{const f=setup();await archive(f);expect((await f.service.page({...f.query,marketplaceAccountId:'other'})).rows).toEqual([]);expect((await f.service.page({...f.query,dateFrom:'2026-10-03',dateTo:'2026-10-04'})).rows).toEqual([]);});
  it('excludes cancelled orders including newer cancellations of cached paid orders',async()=>{const f=setup(),store=new PersistentSnapshots(f.prisma);await store.put('meli','PROFIT_ORDERS','v1|7|2026-10-01|2026-10-02|0|10',{rows:[row],total:1,offset:0,processedOrders:1,incomplete:false,errors:[]},new Date('2020-01-01'));await archive(f,{status:'cancelled'});expect((await f.service.page(f.query)).rows).toEqual([]);});
  it('preserves archive rows after an interrupted legacy refresh',async()=>{const f=setup();await archive(f);await new PersistentSnapshots(f.prisma).put('meli','PROFIT_REFRESH','v1|7|2026-10-01|2026-10-02',{refreshed:true});expect((await f.service.page(f.query)).rows).toHaveLength(1);expect(f.engine.page).not.toHaveBeenCalled();});
  it('preserves unknown costs instead of inventing zero',async()=>{const f=setup();await archive(f,{rows:[{...row,sellerShipping:null,profitBeforeTaxes:null}]});const data=await f.service.page({...f.query,taxRate:12});expect(data.rows[0].sellerShipping).toBeNull();expect(data.rows[0].netProfit).toBeNull();});
  it('reads daily advertising with coverage and account isolation even with refresh=true',async()=>{const f=setup(),store=new PersistentSnapshots(f.prisma);await store.put('meli','PRODUCT_ADS_DAILY','v1|MLB1',{itemId:'MLB1',sellerId:'7',unit:'BRL_CENTS',coverage:[{from:'2026-10-01',to:'2026-10-10'}],values:{'2026-10-01':123,'2026-10-02':456},checkedAt:new Date().toISOString()});const q={...f.query,itemIds:'MLB1',refresh:true,cachedOnly:false};expect((await f.service.advertising(q)).results[0]).toMatchObject({cost:5.79,fromDatabase:true});expect((await f.service.advertising({...q,dateTo:'2026-10-11'})).results[0].cost).toBeNull();expect((await f.service.advertising({...q,marketplaceAccountId:'other'})).results[0].cost).toBeNull();expect(f.engine.advertising).not.toHaveBeenCalled();});
  it('distinguishes saved zero advertising from missing data',async()=>{const f=setup(),store=new PersistentSnapshots(f.prisma),q={...f.query,itemIds:'MLB1',refresh:true};expect((await f.service.advertising(q)).results[0].cost).toBeNull();await store.put('meli','PRODUCT_ADS','v1|7|2026-10-01|2026-10-02|MLB1',{itemId:'MLB1',cost:0});expect((await f.service.advertising(q)).results[0]).toMatchObject({cost:0,fromDatabase:true});expect(f.engine.advertising).not.toHaveBeenCalled();});
  it('preserves manual advertising, buyer freight and tax separately by period',async()=>{const f=setup();await f.service.saveInputs(f.query,{...f.query,taxRate:6,manualAdvertising:[{orderId:'1',itemIndex:0,advertisingCost:8.5}],manualShipping:[{orderId:'1',itemIndex:0,buyerShippingCredit:12.34}]},'user');expect(await f.service.inputs(f.query)).toMatchObject({saved:true,taxRate:6,manualAdvertising:[{advertisingCost:8.5,orderId:'1',itemIndex:0}],manualShipping:[{buyerShippingCredit:12.34,orderId:'1',itemIndex:0}]});expect((await f.service.inputs({...f.query,dateTo:'2026-10-03'})).saved).toBe(false);expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['reports.view']},'POST','/api/reports/profitability/inputs')).toThrow();});
  it('uses the Bling parent title without requesting Bling',async()=>{const f=setup();await archive(f);f.prisma.product.findMany.mockResolvedValue([{sku:'5484',title:'Polo Masculina Custom Slim Fit',variants:[{sku:'5484.01'}]}]);expect((await f.service.page(f.query)).rows[0]).toMatchObject({parentSku:'5484',parentTitle:'Polo Masculina Custom Slim Fit',title:'Polo Marinho XXXG'});expect(f.prisma.product.findMany.mock.calls[0][0].where).toMatchObject({blingAccountId:{in:['bling']}});});
});
