import { ListingPricesService } from '../src/listings/listing-prices.service';

describe('promotion filter across families',()=>{
 const group=(...ids:string[])=>({children:ids.map(itemId=>({itemId,marketplaceAccountId:'account'}))});
 it('requires all prices for no promotion, but one confirmed discount proves a promotion',async()=>{
  const prisma:any={integrationSnapshot:{findMany:jest.fn().mockResolvedValue([
   {marketplaceAccountId:'account',key:'MLB1',payload:{promotional:true}},
   {marketplaceAccountId:'account',key:'MLB2',payload:{promotional:false}}
  ])}};
  const service=new ListingPricesService(prisma,{} as any);
  (service as any).read=jest.fn().mockRejectedValue(Error('Provider unavailable'));
  const groups:any[]=[group('MLB1','MLB3'),group('MLB2'),group('MLB2','MLB4')];
  const progress=await service.annotate(groups);
  expect(groups.map(row=>row.promotionStatus)).toEqual(['with','without','unknown']);
  expect(progress).toMatchObject({total:4,checked:2,remaining:2});
  await new Promise(resolve=>setImmediate(resolve));
  const retry=await service.annotate(groups);
  expect(retry).toMatchObject({unavailable:2,remaining:0});
  expect(groups[2].promotionStatus).toBe('unknown');
  expect((service as any).read).toHaveBeenCalledTimes(2);
 });
 it('keeps account identities separate even for the same item key',async()=>{
  const prisma:any={integrationSnapshot:{findMany:jest.fn().mockResolvedValue([{marketplaceAccountId:'other',key:'MLB1',payload:{promotional:true}}])}};
  const service=new ListingPricesService(prisma,{} as any);
  (service as any).read=jest.fn().mockRejectedValue(Error('Unavailable'));
  const groups:any[]=[group('MLB1')];await service.annotate(groups);
  expect(groups[0].promotionStatus).toBe('unknown');
 });
});
