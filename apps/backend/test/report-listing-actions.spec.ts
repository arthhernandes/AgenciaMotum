import { ProfitabilityEngine } from '../src/reports/profitability-engine';
import { FinanceHttpError } from '../src/reports/finance-api';
import { assertRoutePermissions } from '../src/auth/permissions';
import { ProfitabilityService } from '../src/reports/profitability.service';
import { marketplaceSyncEvents } from '../src/mercadolivre/sync-events';

const row={orderId:'1',itemIndex:0,itemId:'MLB1',sku:'OLD',quantity:2,unitPrice:100,revenue:200,commission:20,sellerShipping:10,fiscalCost:100,invoiceTaxes:0,status:'paid',currency:'BRL',issues:[]};
describe('Listing correction from profitability report',()=>{
  it('requests full variation attributes to read a newly linked SKU instead of the parent SKU',async()=>{
    const get=jest.fn().mockImplementation(async(path:string,params?:any)=>{
      if(path==='/items/MLB1')return {seller_id:7,seller_custom_field:'PARENT',variations:[{id:123,seller_custom_field:'',attributes:params?.include_attributes==='all'?[{id:'SELLER_SKU',value_name:null,values:[{name:'60266.5'}]}]:[]}]};
      if(path==='/items/fiscal_information/60266.5')return {seller_id:7,sku:'60266.5',cost:69};
      throw Error('Unexpected resource '+path);
    });
    const result=await new ProfitabilityEngine({get} as any,'7').refreshFiscal({...row,variationId:123,sku:null});
    expect(get).toHaveBeenCalledWith('/items/MLB1',{include_attributes:'all'});
    expect(result).toMatchObject({sku:'60266.5',fiscalCost:138});
  });
  it('propagates a verified fiscal change to saved reports for the exact account and SKU',async()=>{
    const unchanged={...row,sku:'OTHER'};
    const tx:any={integrationSnapshot:{findMany:jest.fn(async()=>[{id:'snapshot',payload:{rows:[{...row,issues:['Custo fiscal não confirmado para o SKU atual.']},unchanged]}}]),update:jest.fn(async()=>({}))}};
    const prisma:any={$transaction:jest.fn(async fn=>fn(tx))};
    const service=new ProfitabilityService(prisma,{} as any);service.onModuleInit();
    try{
      marketplaceSyncEvents.emit('fiscal-updated',{accountId:'account',sku:'OLD',cost:78});
      await (service as any).fiscalUpdates.get('account');
      const query=tx.integrationSnapshot.findMany.mock.calls[0][0];
      expect(query.where).toMatchObject({marketplaceAccountId:'account',category:{in:['ORDER_HISTORY','PROFIT_ORDERS']},payload:{path:['rows'],array_contains:[{sku:'OLD'}]}});
      const rows=tx.integrationSnapshot.update.mock.calls[0][0].data.payload.rows;
      expect(rows[0]).toMatchObject({fiscalCost:156,profitBeforeTaxes:14,invoiceTaxes:0,issues:[],fiscalCostMessage:null});
      expect(rows[1]).toEqual(unchanged);
      marketplaceSyncEvents.emit('fiscal-updated',{accountId:'account',sku:'OLD'});
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    }finally{service.onModuleDestroy();}
  });
  it('reads the current SKU and replaces a previously confirmed cost using the corrected SKU',async()=>{
    const get=jest.fn().mockImplementation(async(path:string)=>path==='/items/MLB1'?{seller_id:7,attributes:[{id:'SELLER_SKU',value_name:'NEW'}]}:{seller_id:7,sku:'NEW',cost:40});
    const result=await new ProfitabilityEngine({get} as any,'7').refreshFiscal(row);
    expect(result).toMatchObject({sku:'NEW',fiscalCost:80,profitBeforeTaxes:90,netProfit:90});
    expect(get).toHaveBeenCalledWith('/items/fiscal_information/NEW');expect(get.mock.calls.some(call=>call[0].endsWith('/OLD'))).toBe(false);
  });
  it('does not overwrite the report on an inconclusive fiscal query',async()=>{
    const get=jest.fn().mockImplementation(async(path:string)=>{if(path==='/items/MLB1')return {seller_id:7,attributes:[{id:'SELLER_SKU',value_name:'NEW'}]};throw new FinanceHttpError(403,path);});
    await expect(new ProfitabilityEngine({get} as any,'7').refreshFiscal(row)).rejects.toThrow('403');expect(row.fiscalCost).toBe(100);
  });
  it('refreshes all affected family orders and persists them before returning the report',async()=>{
    const prisma:any={marketplaceListing:{findFirst:jest.fn(async()=>({rawData:{family_id:123}})),findMany:jest.fn(async()=>[{itemId:'MLB1'},{itemId:'MLB2'}])}};
    const service=new ProfitabilityService(prisma,{} as any),engine={refreshFiscal:jest.fn(async(row:any)=>({...row,sku:'NEW',fiscalCost:40}))};
    jest.spyOn(service as any,'account').mockResolvedValue({id:'account',sellerId:'7',businessKey:'outlet4u'});
    jest.spyOn(service as any,'savedReport').mockResolvedValue({rows:[row,{...row,orderId:'2',itemId:'MLB2'},{...row,orderId:'3',itemId:'MLB3'}]});
    jest.spyOn(service as any,'engine').mockResolvedValue(engine);
    const persist=jest.spyOn(service as any,'persistRows').mockResolvedValue(undefined);
    jest.spyOn(service,'page').mockResolvedValue({rows:[]} as any);
    await service.refreshListing({marketplaceAccountId:'account',dateFrom:'2026-09-01',dateTo:'2026-09-30',itemId:'MLB1'} as any);
    expect(engine.refreshFiscal).toHaveBeenCalledTimes(2);expect(persist.mock.calls[0][2]).toHaveLength(2);
  });
  it('requires permission to manage listings in addition to report and cost visibility',()=>{
    expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['reports.view','costs.view']},'POST','/api/reports/profitability/refresh-listing')).toThrow();
    expect(()=>assertRoutePermissions({role:'CONSULTANT',permissions:['reports.view','costs.view','listings.manage']},'POST','/api/reports/profitability/refresh-listing')).not.toThrow();
  });
});
