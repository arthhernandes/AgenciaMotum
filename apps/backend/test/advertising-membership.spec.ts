import { observeMemberships, membershipPeriods, AdMembership } from '../src/reports/advertising-membership';
import { allocateActiveAdvertising } from '../src/reports/advertising-allocation';
import { DailyMetrics } from '../src/reports/daily-metrics';

const member:AdMembership={itemId:'MLB1',campaignId:'10',campaignName:'Campanha A',active:true,status:'active',estimatedFrom:'2026-10-01'};
const t0='2026-10-26T12:00:00Z',t1='2026-10-26T12:15:00Z',t2='2026-10-26T12:30:00Z';
describe('Persistent advertising membership intervals',()=>{
  it('creates a labelled initial baseline and repeated polls do not create extra intervals',()=>{
    const initial=observeMemberships(undefined,'7',[member],t0),next=observeMemberships(initial,'7',[member],t1);
    expect(next.items.MLB1.intervals).toHaveLength(1);expect(next.items.MLB1.intervals[0].leftCensored).toBe(true);
    expect(initial.lastObservedAt).toBe(t0);expect(next.items.MLB1.lastObservedAt).toBe(t1);
    expect(membershipPeriods(next,'MLB1',[])[0]).toMatchObject({from:'2026-10-01',to:'2026-10-26',estimated:true});
  });
  it('closes absent ads only after a complete observation and records the uncertainty bounds',()=>{
    const initial=observeMemberships(undefined,'7',[member],t0),removed=observeMemberships(initial,'7',[],t1);
    expect(removed.items.MLB1.intervals[0]).toMatchObject({endedAt:t1,endAfter:t0,endReason:'removed'});
    expect(removed.items.MLB1.events[0]).toMatchObject({after:t0,at:t1,reason:'removed'});
    expect(observeMemberships(removed,'7',[],t2).items.MLB1.intervals).toEqual(removed.items.MLB1.intervals);
  });
  it('records campaign pause, resume and switching without reopening closed intervals',()=>{
    const initial=observeMemberships(undefined,'7',[member],t0),paused=observeMemberships(initial,'7',[{...member,active:false,status:'campaign_paused'}],t1);
    const resumed=observeMemberships(paused,'7',[member],t2),switched=observeMemberships(resumed,'7',[{...member,campaignId:'20'}],'2026-10-27T12:00:00Z');
    expect(switched.items.MLB1.intervals).toHaveLength(3);
    expect(switched.items.MLB1.intervals[0]).toEqual(paused.items.MLB1.intervals[0]);
    expect(switched.items.MLB1.events.map(event=>event.reason)).toEqual(['paused','resumed','campaign_changed']);
    expect(switched.items.MLB1.intervals[2]).toMatchObject({campaignId:'20',leftCensored:false});
  });
  it('preserves unresolved items and ignores stale responses, account mismatch and duplicates',()=>{
    const initial=observeMemberships(undefined,'7',[member],t0);
    expect(observeMemberships(initial,'7',[],t1,['MLB1']).items.MLB1).toEqual(initial.items.MLB1);
    expect(observeMemberships(initial,'7',[],t0)).toBe(initial);
    expect(()=>observeMemberships(initial,'8',[],t1)).toThrow();
    expect(()=>observeMemberships(initial,'7',[member,member],t1)).toThrow();
  });
  it('does not let later campaign imports extend a recorded removal or include a sale after removal',()=>{
    const removed=observeMemberships(observeMemberships(undefined,'7',[member],t0),'7',[],t1);
    const periods=membershipPeriods(removed,'MLB1',[{from:'2026-01-01',to:'2026-12-31',campaignId:'10'}]);
    expect(periods[0]).toMatchObject({from:'2026-10-01',to:'2026-10-26',endedAt:t1});
    const metrics:DailyMetrics={itemId:'MLB1',sellerId:'7',unit:'BRL_CENTS',values:{'2026-10-26':1000},coverage:[{from:'2026-10-01',to:'2026-10-31'}],checkedAt:t2};
    const rows=[{orderId:'1',itemIndex:0,itemId:'MLB1',createdAt:'2026-10-26T12:01:00Z'},{orderId:'2',itemIndex:0,itemId:'MLB1',createdAt:'2026-10-26T13:00:00Z'}];
    const result=allocateActiveAdvertising(rows,new Map([['MLB1',metrics]]),'7',()=>true,new Map([['MLB1',periods]]));
    expect(result.find(row=>row.orderId==='1').cost).toBe(10);expect(result.find(row=>row.orderId==='2').cost).toBeNull();
  });
  it('does not double charge daily spend when resumption occurs the same day',()=>{
    const paused=observeMemberships(observeMemberships(undefined,'7',[member],t0),'7',[{...member,active:false,status:'paused'}],t1);
    const resumed=observeMemberships(paused,'7',[member],t2);
    expect(membershipPeriods(resumed,'MLB1',[]).every(period=>period.ambiguousBoundary)).toBe(true);
  });
  it('does not overwrite a historical campaign with an inferred current campaign before monitoring began',()=>{
    const history=observeMemberships(undefined,'7',[{...member,campaignId:'20',estimatedFrom:'2026-08-18'}],t0);
    const periods=membershipPeriods(history,'MLB1',[{from:'2026-09-01',to:'2026-10-26',campaignId:'10'}]);
    expect(periods.find(period=>period.campaignId==='10')).toMatchObject({from:'2026-09-01',to:'2026-10-25'});
    expect(periods.find(period=>period.campaignId==='20')).toMatchObject({from:'2026-10-26'});
  });
  it('retains an earlier closed period in the same campaign when the ad returned later',()=>{
    const history=observeMemberships(undefined,'7',[{...member,campaignId:'20',estimatedFrom:'2026-08-17'}],t0);
    const periods=membershipPeriods(history,'MLB1',[{from:'2026-08-17',to:'2026-09-21',campaignId:'20'},{from:'2026-09-22',to:'2026-10-26',campaignId:'10'}]);
    expect(periods.find(period=>period.campaignId==='20'&&period.to==='2026-09-21')).toBeDefined();
    expect(periods.find(period=>period.campaignId==='20'&&period.from==='2026-10-26')).toBeDefined();
  });
});
