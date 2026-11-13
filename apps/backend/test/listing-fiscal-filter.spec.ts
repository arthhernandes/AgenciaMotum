import { fiscalState, costAboveBling } from '../src/listings/listing-fiscal-state';
import { ListingFiscalStateService } from '../src/listings/listing-fiscal-state.service';
import { ListingsService } from '../src/listings/listings.service';
import { ListingsController } from '../src/listings/listings.controller';
import { FinanceApi, FinanceHttpError } from '../src/reports/finance-api';
import { marketplaceSyncEvents } from '../src/mercadolivre/sync-events';

const fiscal={sku:'59327.1',seller_id:7,cost:0,measurement_unit:'UN',tax_information:{ncm:'62019300',origin_type:'reseller',origin_detail:0,tax_rule_id:12}};
const variant=(sku:string)=>({sku,listingData:{marketplaceAccountId:'account',marketplaceAccount:{sellerId:'7'}}});
describe('Incomplete fiscal data filter',()=>{
  afterEach(()=>jest.restoreAllMocks());
  it('drains a large catalog without waiting for another UI poll and limits concurrent reads',async()=>{
    let active=0,peak=0;
    const release:Array<()=>void>=[];
    const prisma:any={integrationSnapshot:{findMany:jest.fn(async()=>[]),upsert:jest.fn(async()=>({}))}};
    const get=jest.spyOn(FinanceApi.prototype,'get').mockImplementation(async(path:string)=>{
      active++;peak=Math.max(peak,active);
      await new Promise<void>(resolve=>release.push(resolve));active--;
      return {...fiscal,sku:decodeURIComponent(path.split('/').pop()!)};
    });
    const service=new ListingFiscalStateService(prisma,{} as any);
    const progress=await service.annotate([{variants:Array.from({length:60},(_,i)=>variant('sku'+i))}]);
    expect(progress.remaining).toBe(60);expect(get).toHaveBeenCalledTimes(6);
    for(let round=0;round<100&&prisma.integrationSnapshot.upsert.mock.calls.length<60;round++){
      release.splice(0).forEach(resolve=>resolve());
      await new Promise(resolve=>setImmediate(resolve));
    }
    expect(prisma.integrationSnapshot.upsert).toHaveBeenCalledTimes(60);
    expect(peak).toBe(6);service.onModuleDestroy();
  });
  it('preserves verified fiscal results during stock and catalog synchronization',()=>{
    const prisma:any={integrationSnapshot:{deleteMany:jest.fn()}};
    const service=new ListingFiscalStateService(prisma,{} as any);
    service.onModuleInit();marketplaceSyncEvents.emit('synced','account');service.onModuleDestroy();
    expect(prisma.integrationSnapshot.deleteMany).not.toHaveBeenCalled();
  });
  it('checks mandatory fields and cost while accepting confirmed zero values',()=>{
    expect(fiscalState(fiscal,'59327.1','7')).toEqual({status:'complete',reasons:[]});
    expect(fiscalState({...fiscal,cost:null},'59327.1','7')).toMatchObject({status:'incomplete',reasons:['Custo fiscal não informado']});
    expect(fiscalState({...fiscal,tax_information:{...fiscal.tax_information,ncm:''}},'59327.1','7').reasons).toContain('NCM ausente ou inválido');
    expect(fiscalState(null,'','7').reasons).toContain('SKU ausente');
    expect(fiscalState(fiscal,'59327.1','8').status).toBe('unknown');
  });
  it('compares confirmed acquisition costs in cents, including a real zero Bling cost',()=>{
    expect(costAboveBling(120,100)).toBe(true);expect(costAboveBling(100,100)).toBe(false);expect(costAboveBling(90,100)).toBe(false);
    expect(costAboveBling(10.001,10)).toBe(false);expect(costAboveBling(10,0)).toBe(true);
    for(const missing of [null,undefined,'',NaN,-1,{},false]){expect(costAboveBling(120,missing)).toBe(false);expect(costAboveBling(missing,0)).toBe(false);}
  });
  it('compares exact variation SKUs in the corresponding Bling business only',async()=>{
    const target=(account:string,businessKey:string,sku:string)=>({sku,listingData:{marketplaceAccountId:account,marketplaceAccount:{sellerId:account==='ml1'?'7':'8',businessKey}}});
    const cached=(account:string,seller:string,sku:string,cost:number)=>({marketplaceAccountId:account,key:'v1|'+seller+'|'+sku,payload:{status:'complete',reasons:[],costChecked:true,costCents:cost*100}});
    const cache=(accountId:string,rows:any[])=>({accountId,checkedAt:new Date().toISOString(),rows:rows.map(([sku,cost])=>({sku,cost,stale:false}))});
    const prisma:any={
      integrationSnapshot:{findMany:jest.fn(async()=>[cached('ml1','7','59327.1',120),cached('ml1','7','59327.2',80),cached('ml2','8','59327.1',120)])},
      marketplaceAccount:{findMany:jest.fn(async()=>[{id:'bling1',businessKey:'outlet4u'},{id:'bling2',businessKey:'mottum'}])},
      product:{findMany:jest.fn(async()=>[{id:'p1',blingAccountId:'bling1',variants:[{sku:'59327.1'},{sku:'59327.2'}]},{id:'p2',blingAccountId:'bling2',variants:[{sku:'59327.1'}]}])},
      auditLog:{findMany:jest.fn(async()=>[{entityId:'p1',after:cache('bling1',[['59327.1',100],['59327.2',90]])},{entityId:'p2',after:cache('bling2',[['59327.1',200]])}])}
    };
    const costs:any={find:jest.fn()},service=new ListingFiscalStateService(prisma,{} as any,costs);
    const groups:any[]=[{variants:[target('ml1','outlet4u','59327.1'),target('ml1','outlet4u','59327.2')]},{variants:[target('ml2','mottum','59327.1')]}];
    const progress=await service.annotate(groups,true,['bling1','bling2']);
    expect(progress.remaining).toBe(0);expect(groups[0].costAboveBlingCount).toBe(1);expect(groups[1].costAboveBlingCount).toBe(0);
    expect(groups[0].variants[0]).toMatchObject({fiscalCost:120,blingCost:100,costAboveBling:true});expect(costs.find).not.toHaveBeenCalled();
  });
  it('flags a family if any variation has missing fiscal data',async()=>{
    const prisma:any={integrationSnapshot:{findMany:jest.fn(async()=>[]),upsert:jest.fn(async()=>({}))}};
    jest.spyOn(FinanceApi.prototype,'get').mockImplementation(async(path:string)=>{if(path.endsWith('59327.2'))throw new FinanceHttpError(404,path);return fiscal;});
    const service=new ListingFiscalStateService(prisma,{} as any),group:any={variants:[variant('59327.1'),variant('59327.2'),variant('')]};
    const progress=await service.annotate([group]);
    expect(group).toMatchObject({fiscalStatus:'incomplete',fiscalIncompleteCount:2,fiscalCompleteCount:1});
    expect(progress).toMatchObject({total:2,checked:2,remaining:0});
  });
  it('does not turn authorization failures into incomplete or complete fiscal records',async()=>{
    const prisma:any={integrationSnapshot:{findMany:jest.fn(async()=>[]),upsert:jest.fn(async()=>({}))}};
    jest.spyOn(FinanceApi.prototype,'get').mockRejectedValue(new FinanceHttpError(403,'/items/fiscal_information/59327.1'));
    const group:any={variants:[variant('59327.1')]};
    const progress=await new ListingFiscalStateService(prisma,{} as any).annotate([group]);
    expect(group.fiscalStatus).toBe('checking');expect(progress.unavailable).toBe(1);expect(progress.remaining).toBe(1);expect(progress.checked).toBe(0);
  });
  it('keeps failed reads in progress and retries them automatically after the cooldown',async()=>{
    let now=Date.parse('2026-10-26T12:00:00Z'),cached:any;
    jest.spyOn(Date,'now').mockImplementation(()=>now);
    const prisma:any={integrationSnapshot:{findMany:jest.fn(async()=>cached?[{marketplaceAccountId:'account',key:'v1|7|59327.1',payload:cached}]:[]),upsert:jest.fn(async({create}:any)=>{cached=create.payload;return {};})}};
    const get=jest.spyOn(FinanceApi.prototype,'get').mockRejectedValueOnce(new FinanceHttpError(503,'/items/fiscal_information/59327.1')).mockResolvedValue(fiscal);
    const service=new ListingFiscalStateService(prisma,{} as any),group:any={variants:[variant('59327.1')]};
    expect(await service.annotate([group])).toMatchObject({checked:0,remaining:1});
    expect(await service.annotate([group])).toMatchObject({checked:0,remaining:1});expect(get).toHaveBeenCalledTimes(1);
    now+=5001;expect(await service.annotate([group])).toMatchObject({checked:1,remaining:0});expect(group.fiscalStatus).toBe('complete');expect(get).toHaveBeenCalledTimes(2);
  });
  it('filters before pagination and preserves all siblings for editing the family',async()=>{
    const prisma:any={integrationSnapshot:{findMany:jest.fn(async()=>[])},marketplaceAccount:{findMany:jest.fn(async()=>[])},product:{findMany:jest.fn(async()=>[])},productVariant:{findMany:jest.fn(async()=>[])}};
    const fiscal:any={annotate:jest.fn(async(groups:any[])=>{groups.forEach(group=>group.fiscalStatus=group.familyId==='1'?'incomplete':'complete');return {remaining:0};})};
    const service=new ListingsService(prisma,fiscal);
    const item=(id:string,family:number)=>({id,itemId:'MLB'+id,marketplaceAccountId:'account',marketplaceAccount:{businessKey:'x'},rawData:{family_id:family},variants:[{sku:'59327.'+id}],price:1,links:[]});
    jest.spyOn(service,'findAll').mockResolvedValue({data:[item('1',1),item('2',1),item('3',2)]} as any);
    const result=await service.findGrouped({page:1,limit:50,fiscalStatus:'incomplete'});
    expect(result.pagination.total).toBe(1);expect(result.data[0].children).toHaveLength(2);
  });
  it('requires cost permission and invalidates the cached state after fiscal edits',()=>{
    const controller=new ListingsController({findGrouped:jest.fn()} as any,{} as any);
    expect(()=>controller.grouped({page:1,limit:50,fiscalStatus:'incomplete'},{user:{role:'VIEWER',permissions:['listings.view']}})).toThrow();
    const prisma:any={integrationSnapshot:{deleteMany:jest.fn().mockResolvedValue({})}},service=new ListingFiscalStateService(prisma,{} as any);
    service.onModuleInit();marketplaceSyncEvents.emit('fiscal-updated',{accountId:'account',sku:'59327.1'});service.onModuleDestroy();
    expect(prisma.integrationSnapshot.deleteMany).toHaveBeenCalledWith({where:{marketplaceAccountId:'account',category:'LISTING_FISCAL_STATE',key:{endsWith:'|59327.1'}}});
  });
});
