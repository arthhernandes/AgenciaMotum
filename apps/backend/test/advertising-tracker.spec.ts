import { AdvertisingTrackerService } from '../src/reports/advertising-tracker.service';
import { ProductAds } from '../src/reports/product-ads';
import { FinanceApi } from '../src/reports/finance-api';
import { marketplaceSyncEvents } from '../src/mercadolivre/sync-events';

describe('Advertising observation persistence and scheduling',()=>{
  afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
  function setup(){
    let record:any=null;
    const findUnique=jest.fn(async()=>record),upsert=jest.fn(async({create,update}:any)=>{record=record?{...record,...update}:create;return record;});
    const tx={integrationSnapshot:{findUnique,upsert},$executeRaw:jest.fn()};
    const prisma:any={marketplaceAccount:{findUniqueOrThrow:jest.fn(async()=>({sellerId:'7',active:true,marketplace:'MERCADO_LIVRE'}))},integrationSnapshot:{findUnique},$transaction:jest.fn(async(work:any)=>work(tx))};
    jest.spyOn(FinanceApi.prototype,'get').mockResolvedValue({id:7});
    jest.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-26T15:00:00Z'));
    return {prisma,upsert,record:()=>record,service:new AdvertisingTrackerService(prisma,{getValidAccessToken:jest.fn()} as any)};
  }
  it('persists baseline, removal and closed intervals across service restarts',async()=>{
    const f=setup(),snapshot=jest.spyOn(ProductAds.prototype,'memberships');
    snapshot.mockResolvedValueOnce({startedAt:'2026-10-26T12:00:00Z',observedAt:'2026-10-26T12:01:00Z',members:[{itemId:'MLB1',campaignId:'10',active:true,status:'active'}],unknownIds:[]});
    await f.service.syncAccount('account');
    snapshot.mockResolvedValueOnce({startedAt:'2026-10-26T12:15:00Z',observedAt:'2026-10-26T12:16:00Z',members:[],unknownIds:[]});
    await new AdvertisingTrackerService(f.prisma,{} as any).syncAccount('account');
    const interval=f.record().payload.items.MLB1.intervals[0];expect(interval).toMatchObject({endedAt:'2026-10-26T12:16:00Z',endAfter:'2026-10-26T12:01:00Z'});
    expect(f.upsert).toHaveBeenCalledTimes(2);
  });
  it('does not mutate history after a failed or incomplete provider read',async()=>{
    const f=setup();jest.spyOn(ProductAds.prototype,'memberships').mockRejectedValue(Error('Incomplete pagination'));
    await expect(f.service.syncAccount('account')).rejects.toThrow();expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('discards overlapping observations superseded by a newer transaction',async()=>{
    const f=setup(),snapshot=jest.spyOn(ProductAds.prototype,'memberships');
    snapshot.mockResolvedValueOnce({startedAt:'2026-10-26T13:00:00Z',observedAt:'2026-10-26T13:01:00Z',members:[],unknownIds:[]});await f.service.syncAccount('account');
    snapshot.mockResolvedValueOnce({startedAt:'2026-10-26T12:59:00Z',observedAt:'2026-10-26T13:02:00Z',members:[],unknownIds:[]});await f.service.syncAccount('account');
    expect(f.upsert).toHaveBeenCalledTimes(1);
  });
  it('observes at startup, every 15 minutes and after catalog sync, removing timers on shutdown',async()=>{
    jest.useFakeTimers();const service=new AdvertisingTrackerService({} as any,{} as any),tick=jest.spyOn(service,'tick').mockResolvedValue(),sync=jest.spyOn(service,'syncAccount').mockResolvedValue();
    service.onModuleInit();marketplaceSyncEvents.emit('synced','account');expect(sync).toHaveBeenCalledWith('account');
    await jest.advanceTimersByTimeAsync(5000);expect(tick).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(15*60_000-5000);expect(tick).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();await jest.advanceTimersByTimeAsync(15*60_000);expect(tick).toHaveBeenCalledTimes(2);
  });
});
