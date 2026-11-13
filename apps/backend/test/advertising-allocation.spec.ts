import { allocateActiveAdvertising, reportAdvertisingPeriods, confirmPeriodAdvertising } from '../src/reports/advertising-allocation';
import { DailyMetrics } from '../src/reports/daily-metrics';
import { ProfitabilityService } from '../src/reports/profitability.service';

describe('Total item advertising divided by all its sales in the active campaign interval',()=>{
  const row={orderId:'1',itemIndex:0,itemId:'MLB1',createdAt:'2026-09-28T12:00:00-03:00'};
  const data:DailyMetrics={itemId:'MLB1',sellerId:'7',unit:'BRL_CENTS',values:{'2026-10-03':1001,'2026-10-15':9000},coverage:[{from:'2026-09-28',to:'2026-10-26'}],checkedAt:'2026-10-26'};
  const metrics=new Map([['MLB1',data]]),periods=new Map([['MLB1',[{from:'2026-10-03',to:'2026-10-26'}]]]);
  const active=(id:string,day:string)=>({...row,orderId:id,createdAt:day+'T12:00:00-03:00'});
  it('includes all interval sales, even on zero-spend days, and excludes sales before campaign creation',()=>{
    const result=allocateActiveAdvertising([row,active('2','2026-10-04'),active('3','2026-10-20')],metrics,'7',()=>true,periods);
    expect(result.find(r=>r.orderId==='1').cost).toBe(0);
    expect(result.filter(r=>r.orderId!=='1').map(r=>r.cost)).toEqual([50.01,50]);
    expect(result[0]).toMatchObject({periodCost:100.01,orders:2,activeFrom:'2026-10-03',activeTo:'2026-10-26'});
  });
  it('divides by distinct sales, not revenue or number of order lines',()=>{
    const base=active('2','2026-10-04');
    const result=allocateActiveAdvertising([base,{...base,itemIndex:1},active('3','2026-10-20')],metrics,'7',()=>true,periods);
    expect(result.map(r=>r.cost)).toEqual([25.01,25,50]);
  });
  it('never shares across ads and requires complete sales for the entire interval',()=>{
    expect(allocateActiveAdvertising([active('2','2026-10-04')],metrics,'7',()=>false,periods)[0].cost).toBeNull();
    expect(allocateActiveAdvertising([{...active('2','2026-10-04'),itemId:'MLB2'}],metrics,'7',()=>true,periods)[0].cost).toBeNull();
  });
  it('does not infer an active interval from spending days',()=>{
    expect(allocateActiveAdvertising([active('2','2026-10-03')],metrics,'7',()=>true,new Map())[0].cost).toBeNull();
  });
  it('confirms zero only from a complete expense inventory and rates missing campaign links without double charging',()=>{
    const rows=[active('1','2026-09-01'),active('2','2026-09-20'),{...active('3','2026-09-01'),itemId:'MLB2'}];
    const allocation=[{orderId:'1',itemIndex:0,cost:4},{orderId:'2',itemIndex:0,cost:null},{orderId:'3',itemIndex:0,cost:null}];
    const inventory={dateFrom:'2026-09-01',dateTo:'2026-09-30',sellerId:'7',complete:true,scope:'all_ads',costs:[{itemId:'MLB1',costCents:1001,campaignId:'10'}]};
    const result=confirmPeriodAdvertising(rows,allocation,inventory,'7','2026-09-01','2026-09-30',true);
    expect(result.map(row=>row.cost)).toEqual([5.01,5,0]);
    expect(result[0].note).toContain('vínculo histórico');expect(result[2].note).toContain('Sem registro de gasto');
    expect(confirmPeriodAdvertising(rows,allocation,{...inventory,complete:false},'7','2026-09-01','2026-09-30',true)).toBe(allocation);
    expect(confirmPeriodAdvertising(rows,allocation,inventory,'8','2026-09-01','2026-09-30',true)).toBe(allocation);
    expect(confirmPeriodAdvertising(rows,allocation,inventory,'7','2026-08-01','2026-08-31',true)).toBe(allocation);
  });
  it('calculates September from its confirmed spending despite missing March campaign history',()=>{
    const data:DailyMetrics={itemId:'MLB1',sellerId:'7',unit:'BRL_CENTS',values:{'2026-09-15':27082},coverage:[{from:'2026-07-25',to:'2026-10-26'}],checkedAt:'2026-10-26'};
    const ranges=reportAdvertisingPeriods([{from:'2026-03-30',to:'2026-10-08',ambiguousBoundary:true,ambiguousDays:['2026-10-08']}],'2026-09-01','2026-09-30');
    const result=allocateActiveAdvertising([active('1','2026-09-01'),active('2','2026-09-20')],new Map([['MLB1',data]]),'7',()=>true,new Map([['MLB1',ranges]]));
    expect(result.map(row=>row.cost)).toEqual([135.41,135.41]);
    expect(result[0]).toMatchObject({activeFrom:'2026-09-01',activeTo:'2026-09-30',periodCost:270.82,orders:2});
  });
  it('does not require campaign expenses or sales from outside the selected period',async()=>{
    const window={itemId:'MLB1',from:'2026-03-30',to:'2026-10-26'};
    const prisma:any={integrationSnapshot:{findMany:jest.fn().mockResolvedValue([{category:'PRODUCT_ADS_DAILY',payload:data},{category:'PRODUCT_ADS_ACTIVE_WINDOW',payload:window}])}};
    const service=new ProfitabilityService(prisma,{} as any);
    jest.spyOn(service as any,'account').mockResolvedValue({id:'account',sellerId:'7'});
    const report=jest.spyOn(service as any,'savedReport').mockImplementation(async(...args:any[])=>({rows:args[1].dateFrom==='2026-10-04'?[active('2','2026-10-04')]:[active('2','2026-10-04'),active('3','2026-10-20')],incomplete:false,errors:[]}));
    const result=await service.advertisingAllocation({marketplaceAccountId:'account',dateFrom:'2026-10-04',dateTo:'2026-10-04'});
    expect(result.results).toHaveLength(1);expect(result.results[0]).toMatchObject({cost:0,orders:1,activeFrom:'2026-10-04',activeTo:'2026-10-04'});
    expect(report).toHaveBeenCalledTimes(1);
  });
});
