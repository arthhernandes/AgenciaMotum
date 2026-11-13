import { advertisingImportFrom,orderImportRanges } from '../src/reports/incremental-ranges';
import { DailyMetrics } from '../src/reports/daily-metrics';
describe('Incremental import planning',()=>{
 const ad=(from:string,to:string):DailyMetrics=>({itemId:'MLB1',sellerId:'7',unit:'BRL_CENTS',values:{},coverage:[{from,to}],checkedAt:new Date().toISOString()});
 it('imports new advertising dates and rechecks recent metrics',()=>{expect(advertisingImportFrom([ad('2026-07-25','2026-10-22')],'2026-07-26','2026-10-23')).toBe('2026-10-20');});
 it('backfills first-time ads and fills gaps without relying on a different record coverage',()=>{expect(advertisingImportFrom([],'2026-07-26','2026-10-23')).toBe('2026-07-26');expect(advertisingImportFrom([ad('2026-07-26','2026-10-22'),ad('2026-07-26','2026-10-20')],'2026-07-26','2026-10-23')).toBe('2026-10-20');});
 it('refreshes only the recent days if advertising is already covered',()=>{expect(advertisingImportFrom([ad('2026-07-26','2026-10-23')],'2026-07-26','2026-10-23')).toBe('2026-10-21');});
 it('imports the initial order history and then reconciles only the recent tail',()=>{
  expect(orderImportRanges('2026-10-01','2026-10-23',[])).toEqual([{from:'2026-10-01',to:'2026-10-23'}]);
  const dates=Array.from({length:22},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'));
  expect(orderImportRanges('2026-10-01','2026-10-23',dates)).toEqual([{from:'2026-10-16',to:'2026-10-23'}]);
  expect(orderImportRanges('2026-10-01','2026-10-23',dates,0)).toEqual([{from:'2026-10-23',to:'2026-10-23'}]);
 });
 it('recovers older holes even when newer days have been synced',()=>{expect(orderImportRanges('2026-10-01','2026-10-05',['2026-10-01','2026-10-03','2026-10-04','2026-10-05'],0)).toEqual([{from:'2026-10-02',to:'2026-10-02'}]);});
 it('rejects invalid lookback values',()=>{for(const n of [-1,91,NaN,1.5])expect(()=>orderImportRanges('2026-10-01','2026-10-23',[],n)).toThrow();});
});
