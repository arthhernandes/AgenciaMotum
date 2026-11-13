import { ProfitabilityService } from '../src/reports/profitability.service';
import { FinanceApi } from '../src/reports/finance-api';

describe('Historical listing parents',()=>{
 afterEach(()=>jest.restoreAllMocks());
 function setup(){
  const prisma:any={integrationSnapshot:{findUnique:jest.fn(async()=>null),upsert:jest.fn(async()=>({}))}};
  const service=new ProfitabilityService(prisma,{} as any);
  jest.spyOn(service as any,'account').mockResolvedValue({id:'account',sellerId:'7'});
  jest.spyOn(service as any,'savedReport').mockResolvedValue({rows:[{itemId:'MLB1'},{itemId:'MLB2'}]});
  return {service,prisma,query:{itemIds:'MLB1,MLB2',dateFrom:'2026-09-01',dateTo:'2026-09-30'} as any};
 }
 it('recovers and saves one parent family for historical color and size variations',async()=>{
  const f=setup();jest.spyOn(FinanceApi.prototype,'get').mockImplementation(async(path:string)=>({id:path.split('/').pop(),seller_id:7,family_id:123,family_name:'Polo original'}));
  const result=await f.service.listingParents(f.query);
  expect(result.errors).toEqual([]);expect(result.results).toHaveLength(2);
  expect(result.results.every(row=>row.parentListingId==='123'&&row.parentListingTitle==='Polo original')).toBe(true);
  expect(f.prisma.integrationSnapshot.upsert).toHaveBeenCalledTimes(2);
  expect(f.prisma.integrationSnapshot.upsert.mock.calls[0][0].create).toMatchObject({marketplaceAccountId:'account',category:'REPORT_LISTING_PARENT'});
 });
 it('does not assign a family from another seller or an unavailable item',async()=>{
  const f=setup();jest.spyOn(FinanceApi.prototype,'get').mockResolvedValue({id:'MLB1',seller_id:8,family_id:123});
  expect((await f.service.listingParents(f.query)).results).toEqual([]);expect(f.prisma.integrationSnapshot.upsert).not.toHaveBeenCalled();
 });
 it('uses confirmed saved parent metadata without another external request',async()=>{
  const f=setup();f.prisma.integrationSnapshot.findUnique.mockImplementation(async({where}:any)=>({payload:{sellerId:'7',itemId:where.marketplaceAccountId_category_key.key,parentListingId:'123'}}));
  const get=jest.spyOn(FinanceApi.prototype,'get');expect((await f.service.listingParents(f.query)).results).toHaveLength(2);expect(get).not.toHaveBeenCalled();
 });
});
