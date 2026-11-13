import { ListingSalesService } from '../src/listings/listing-sales.service';
import { FinanceApi } from '../src/reports/finance-api';
describe('Listing units sold within the visits period',()=>{
 it('reports real completed query windows and isolates progress by account and request',async()=>{
  const f=setup();const releases:Array<(value:any)=>void>=[];
  const get=jest.spyOn(FinanceApi.prototype,'get').mockImplementation(()=>new Promise(resolve=>releases.push(resolve)));
  const task=f.service.ranking('bling',['MLB1'],'2026-10-01','2026-10-02','request-one');
  for(let tick=0;tick<30&&get.mock.calls.length<2;tick++)await Promise.resolve();
  expect(get).toHaveBeenCalledTimes(2);expect(f.service.progress('bling','request-one')).toMatchObject({percent:0,completed:0,total:2});
  releases[0]({results:[],paging:{total:0}});for(let tick=0;tick<10;tick++)await Promise.resolve();
  expect(f.service.progress('bling','request-one')).toMatchObject({percent:50,completed:1,total:2});
  expect(f.service.progress('other-account','request-one').percent).toBe(0);
  expect(f.service.progress('bling','other-request').percent).toBe(0);
  releases[1]({results:[],paging:{total:0}});await task;
  expect(f.service.progress('bling','request-one')).toMatchObject({percent:100,completed:2,total:2,status:'COMPLETE'});
 });
 it('builds a complete period ranking from seller orders without filtering to the current page',async()=>{
  const f=setup();f.prisma.marketplaceListing.findMany.mockResolvedValue([{itemId:'MLB1',marketplaceAccountId:'ml',marketplaceAccount:{sellerId:'7'}},{itemId:'MLB99',marketplaceAccountId:'ml',marketplaceAccount:{sellerId:'7'}},{itemId:'MLB3',marketplaceAccountId:'ml',marketplaceAccount:{sellerId:'7'}}] as any);
  const get=jest.spyOn(FinanceApi.prototype,'get').mockResolvedValue({results:[order('one',2,11,'2026-10-01T12:00:00-03:00'),{...order('two',25,12,'2026-10-01T13:00:00-03:00'),order_items:[{item:{id:'MLB99',variation_id:12},quantity:25}]}],paging:{total:2}});
  const result=await f.service.ranking('bling',['MLB1','MLB99','MLB3'],'2026-10-01','2026-10-01');
  expect(result.items.find(item=>item.itemId==='MLB99').soldQuantity).toBe(25);expect(result.items.find(item=>item.itemId==='MLB3').soldQuantity).toBe(0);
  expect(get.mock.calls[0][1]).not.toHaveProperty('item');expect(get.mock.calls[0][1]).toMatchObject({seller:'7','order.status':'paid','order.date_created.from':'2026-10-01T00:00:00.000-03:00','order.date_created.to':'2026-10-02T00:00:00.000-03:00'});
 });
 it('refuses to show a ranking when any order window is incomplete instead of returning misleading zeros',async()=>{
  const f=setup();jest.spyOn(FinanceApi.prototype,'get').mockResolvedValue({results:[],paging:{total:10}});
  await expect(f.service.ranking('bling',['MLB1'],'2026-10-01','2026-10-01')).rejects.toThrow('ranking não foi aplicado');
  expect(f.prisma.integrationSnapshot.upsert).not.toHaveBeenCalled();
 });
 afterEach(()=>jest.restoreAllMocks());
 function setup(){const prisma:any={marketplaceAccount:{findFirst:jest.fn(async()=>({id:'bling',marketplace:'BLING',businessKey:'x'}))},marketplaceListing:{findMany:jest.fn(async()=>[{itemId:'MLB1',marketplaceAccountId:'ml',marketplaceAccount:{sellerId:'7'}}])},integrationSnapshot:{findUnique:jest.fn(async()=>null),upsert:jest.fn(async()=>({}))}};return {prisma,service:new ListingSalesService(prisma,{} as any)};}
 const order=(id:string,quantity:number,variation=11,date='2026-10-02T12:00:00-03:00')=>({id,seller:{id:7},status:'paid',date_created:date,order_items:[{item:{id:'MLB1',variation_id:variation},quantity},{item:{id:'MLB2'},quantity:99}]});
 it('paginates paid orders and sums matching units and variations instead of counting orders',async()=>{
  const f=setup(),get=jest.spyOn(FinanceApi.prototype,'get').mockResolvedValueOnce({results:[order('1',2),order('2',3,12)],paging:{total:3}}).mockResolvedValueOnce({results:[{...order('3',8),status:'cancelled'}],paging:{total:3}});
  const result=(await f.service.find('bling',['MLB1'],'2026-10-01','2026-10-02')).items[0];
  expect(result.soldQuantity).toBe(5);expect(result.variations).toEqual([{variationId:'11',soldQuantity:2},{variationId:'12',soldQuantity:3}]);
  expect(get.mock.calls[0][1]).toMatchObject({seller:'7',item:'MLB1','order.status':'paid','order.date_created.from':'2026-10-01T00:00:00.000-03:00','order.date_created.to':'2026-10-03T00:00:00.000-03:00'});
  expect(get.mock.calls[1][1]?.offset).toBe(2);
 });
 it('includes the last local hour and excludes the next local midnight',async()=>{
  const f=setup();jest.spyOn(FinanceApi.prototype,'get').mockResolvedValue({results:[order('1',2,11,'2026-10-03T02:59:59Z'),order('2',9,11,'2026-10-03T03:00:00Z')],paging:{total:2}});
  expect((await f.service.find('bling',['MLB1'],'2026-10-02','2026-10-02')).items[0].soldQuantity).toBe(2);
 });
 it('distinguishes a confirmed zero from an incomplete query',async()=>{
  const f=setup(),get=jest.spyOn(FinanceApi.prototype,'get').mockResolvedValueOnce({results:[],paging:{total:0}}).mockResolvedValueOnce({results:[],paging:{total:1}});
  expect((await f.service.find('bling',['MLB1'],'2026-10-01','2026-10-02')).items[0].soldQuantity).toBe(0);
  expect((await f.service.find('bling',['MLB1'],'2026-10-03','2026-10-04')).items[0].soldQuantity).toBeNull();expect(get).toHaveBeenCalledTimes(2);
 });
 it('rejects unrelated accounts and invalid periods before external reads',async()=>{const f=setup(),get=jest.spyOn(FinanceApi.prototype,'get');await expect(f.service.find('bling',['MLB2'],'2026-10-01','2026-10-02')).rejects.toThrow();await expect(f.service.find('bling',['MLB1'],'2026-02-30','2026-10-02')).rejects.toThrow();expect(get).not.toHaveBeenCalled();});
});
