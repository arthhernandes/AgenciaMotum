import { MercadoLivreSyncService } from '../src/mercadolivre/synchronization/mercadolivre-sync.service';
import { creationDay } from '../src/mercadolivre/synchronization/created-day';

describe('MercadoLivreSyncService test import', () => {
  it('uses Brasília calendar dates at UTC midnight and local midnight boundaries',()=>{expect(creationDay('2026-11-05T02:59:59.999Z')).toBe('2026-11-04');expect(creationDay('2026-11-05T03:00:00.000Z')).toBe('2026-11-05');expect(creationDay('2026-11-04T01:00:00Z')).toBe('2026-11-03');expect(creationDay('invalid')).toBeNull();});
  it('only imports items created today, including cached items from today, and never fetches known old bodies',async()=>{
    jest.useFakeTimers().setSystemTime(new Date('2026-11-04T17:00:00Z'));
    try{
      const prisma:any={syncExecution:{findFirst:jest.fn().mockResolvedValue(null),create:jest.fn().mockResolvedValue({id:'sync'}),update:jest.fn()},marketplaceAccount:{findUniqueOrThrow:jest.fn().mockResolvedValue({sellerId:'123'})},marketplaceListing:{upsert:jest.fn().mockResolvedValue({id:'listing'})},$queryRaw:jest.fn().mockResolvedValue([{itemId:'MLB1',createdAt:'2026-11-03T20:00:00Z'},{itemId:'MLB2',createdAt:'2026-11-04T04:00:00Z'}])};
      const items=[{id:'MLB2',date_created:'2026-11-04T04:00:00Z'},{id:'MLB3',date_created:'2026-11-05T02:59:59Z'},{id:'MLB4',date_created:'2026-11-04T02:59:59Z'},{id:'MLB5',date_created:'2026-11-05T03:00:00Z'}];
      const client:any={searchSellerItems:jest.fn().mockResolvedValue({results:['MLB1','MLB2','MLB3','MLB4','MLB5'],paging:{total:5}}),getItems:jest.fn().mockResolvedValue(items.map(body=>({code:200,body})))};
      const service=new MercadoLivreSyncService(prisma,{getValidAccessToken:jest.fn().mockResolvedValue('token')} as any,client,{run:jest.fn()} as any,{run:jest.fn()} as any);
      const result=await service.syncToday('account');expect(client.getItems).toHaveBeenCalledWith('token',['MLB2','MLB3','MLB4','MLB5']);expect(result).toMatchObject({processed:2,day:'2026-11-04',scope:'today',errors:[]});expect(prisma.marketplaceListing.upsert.mock.calls.map((c:any[])=>c[0].create.itemId)).toEqual(['MLB2','MLB3']);
    }finally{jest.useRealTimers();}
  });
  it('blocks the today action while another synchronization is running',async()=>{const prisma:any={syncExecution:{findFirst:jest.fn().mockResolvedValue({id:'running'})}};const service=new MercadoLivreSyncService(prisma,{} as any,{} as any,{} as any,{} as any);await expect(service.syncToday('account')).rejects.toThrow('andamento');});
  it('records the provider reason and stage without allowing the background fallback to replace it',async()=>{
    const writes:any[]=[];let status='RUNNING';
    const prisma:any={syncExecution:{findFirst:jest.fn().mockResolvedValue(null),create:jest.fn().mockResolvedValue({id:'sync'}),findUniqueOrThrow:jest.fn().mockResolvedValue({id:'sync'}),update:jest.fn(async({data}:any)=>{writes.push(data);status=data.status;}),updateMany:jest.fn(async({data}:any)=>{if(status==='RUNNING'){writes.push(data);status=data.status;}return {count:0};})},marketplaceAccount:{findUniqueOrThrow:jest.fn().mockResolvedValue({sellerId:'123'})}};
    const client:any={searchSellerItems:jest.fn().mockResolvedValue({results:['MLB1'],paging:{total:1}}),getItems:jest.fn().mockRejectedValue({response:{status:403,data:{error:'ResourceDeprecated',message:'Resource deprecated'}}})};
    const service=new MercadoLivreSyncService(prisma,{getValidAccessToken:jest.fn().mockResolvedValue('secret')} as any,client,{} as any,{} as any);
    await service.startBackground('account');await new Promise(resolve=>setTimeout(resolve,10));
    expect(writes).toHaveLength(1);expect(writes[0].errorDetails).toEqual([expect.objectContaining({httpStatus:403,providerError:'ResourceDeprecated',message:'Resource deprecated',stage:'items',itemIds:['MLB1']})]);expect(JSON.stringify(writes)).not.toContain('secret');
  });
  it('continues a full sync using the scroll cursor instead of an offset', async () => {
    const prisma = { syncExecution: { create: jest.fn().mockResolvedValue({ id: 'execution' }), update: jest.fn() }, marketplaceAccount: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sellerId: 'seller' }) }, marketplaceListing: { findMany:jest.fn().mockResolvedValue([]), upsert: jest.fn().mockResolvedValue({ id: 'listing' }) } };
    const client = { searchSellerItems: jest.fn().mockResolvedValueOnce({ results: ['MLB1'], paging: { total: 2 }, scroll_id: 'cursor1' }).mockResolvedValueOnce({ results: ['MLB2'], paging: { total: 2 }, scroll_id: 'cursor2' }), getItems: jest.fn().mockImplementation(async (_token, ids: string[]) => ids.map(id => ({ code: 200, body: { id } }))) };
    const service = new MercadoLivreSyncService(prisma as never, { getValidAccessToken: jest.fn().mockResolvedValue('token') } as never, client as never, { run: jest.fn() } as never, { run: jest.fn() } as never);
    const result = await service.syncAccount('account');
    expect(client.searchSellerItems).toHaveBeenNthCalledWith(2, 'token', 'seller', { search_type: 'scan', scroll_id: 'cursor1', limit: 50 });
    expect(result.processed).toBe(2);
  });
  it('imports no more than five items even when search returns a larger page', async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `MLB${index}`);
    const prisma = {
      syncExecution: { create: jest.fn().mockResolvedValue({ id: 'execution' }), update: jest.fn().mockResolvedValue({}) },
      marketplaceAccount: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sellerId: 'seller' }) },
      marketplaceListing: { findMany:jest.fn().mockResolvedValue([]), upsert: jest.fn().mockResolvedValue({ id: 'listing' }) }
    };
    const client = {
      searchSellerItems: jest.fn().mockResolvedValue({ results: ids, paging: { total: 100 } }),
      getItems: jest.fn().mockImplementation(async (_token, itemIds: string[]) => itemIds.map(id => ({ code: 200, body: { id } })))
    };
    const service = new MercadoLivreSyncService(prisma as never, { getValidAccessToken: jest.fn().mockResolvedValue('token') } as never, client as never, { run: jest.fn().mockResolvedValue({}) } as never, { run: jest.fn().mockResolvedValue({}) } as never);
    const result = await service.syncAccount('account', undefined, 5);
    expect(client.searchSellerItems).toHaveBeenCalledTimes(1);
    expect(client.searchSellerItems).toHaveBeenCalledWith('token', 'seller', { offset: 0, limit: 5 });
    expect(client.getItems).toHaveBeenCalledWith('token', ids.slice(0, 5));
    expect(prisma.marketplaceListing.upsert).toHaveBeenCalledTimes(5);
    expect(result.processed).toBe(5);
    expect(prisma.syncExecution.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ itemsProcessed: 5, errorDetails: { progress: { total: 5, attempted: 5, percent: 99 } } }) }));
  });
});
