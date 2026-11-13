import { dailyTotal, mergeDaily, visitDays, DailyMetrics, coverVisitsFromTotal, missingDailyRanges } from '../src/reports/daily-metrics';
describe('Durable daily metrics',()=>{
 it('resumes new days with one day of overlap instead of importing the whole history again',()=>{
  expect(missingDailyRanges(sample(),'2026-10-01','2026-10-04','visits')).toEqual([{from:'2026-10-03',to:'2026-10-04'}]);
  expect(missingDailyRanges(sample(),'2026-10-01','2026-10-03','visits')).toEqual([]);
 });
 it('backfills gaps in bounded windows and includes every missing day',()=>{
  const ranges=missingDailyRanges(undefined,'2024-10-22','2026-10-22','visits');
  for(const range of ranges)expect((Date.parse(range.to)-Date.parse(range.from))/86400000+1).toBeLessThanOrEqual(150);
  for(let day='2024-10-22';day<='2026-10-22';day=new Date(Date.parse(day)+86400000).toISOString().slice(0,10))expect(ranges.some(r=>r.from<=day&&day<=r.to)).toBe(true);
  const single=missingDailyRanges({...sample(),coverage:[{from:'2026-10-02',to:'2026-10-03'}]},'2026-10-01','2026-10-03','visits');expect(single).toEqual([{from:'2026-10-01',to:'2026-10-02'}]);
 });
 const sample=():DailyMetrics=>({itemId:'MLB1',sellerId:'7',unit:'visits',coverage:[{from:'2026-10-01',to:'2026-10-03'}],values:{'2026-10-01':5,'2026-10-03':8},checkedAt:new Date().toISOString()});
 it('sums arbitrary inclusive subranges and confirmed sparse zeros',()=>{expect(dailyTotal(sample(),'MLB1','2026-10-02','2026-10-03','visits')).toBe(8);expect(dailyTotal(sample(),'MLB1','2026-10-02','2026-10-02','visits')).toBe(0);});
 it('does not turn missing days, other listings, units or invalid counts into zero',()=>{
  expect(dailyTotal(sample(),'MLB1','2026-09-30','2026-10-02','visits')).toBeNull();expect(dailyTotal(sample(),'MLB2','2026-10-01','2026-10-02','visits')).toBeNull();expect(dailyTotal(sample(),'MLB1','2026-10-01','2026-10-02','BRL_CENTS')).toBeNull();
  expect(dailyTotal({...sample(),coverage:[{from:'2026-10-01',to:'2026-10-01'},{from:'2026-10-03',to:'2026-10-03'}]},'MLB1','2026-10-01','2026-10-03','visits')).toBeNull();expect(dailyTotal({...sample(),values:{'2026-10-01':-1}},'MLB1','2026-10-01','2026-10-01','visits')).toBeNull();
 });
 it('merges adjacent coverage without doubling overlap and replaces corrected zeros',()=>{
  const data=mergeDaily(sample(),{...sample(),coverage:[{from:'2026-10-03',to:'2026-10-04'}],values:{'2026-10-04':2}});expect(data.coverage).toEqual([{from:'2026-10-01',to:'2026-10-04'}]);expect(dailyTotal(data,'MLB1','2026-10-01','2026-10-04','visits')).toBe(7);expect(()=>mergeDaily(sample(),{...sample(),sellerId:'8'})).toThrow();
 });
 it('fills only proven zero remainders when the fresh retained total matches the known daily sum',()=>{
  const data=coverVisitsFromTotal(sample(),'2026-09-01','2026-10-04',13)!;expect(dailyTotal(data,'MLB1','2026-09-01','2026-09-30','visits')).toBe(0);expect(dailyTotal(data,'MLB1','2026-09-01','2026-10-04','visits')).toBe(13);
  expect(coverVisitsFromTotal(sample(),'2026-09-01','2026-10-04',14)).toBeNull();expect(coverVisitsFromTotal({...sample(),coverage:[]},'2026-09-01','2026-10-04',13)).toBeNull();
 });
 it('keeps provider calendar dates despite its UTC-4 metadata and verifies the series sum',()=>{
  const response={item_id:'MLB1',date_from:'2026-10-01T00:00:00-04:00',date_to:'2026-10-03T00:00:00-04:00',total_visits:5,results:[{date:'2026-10-01T00:00:00Z',total:5}]};
  expect(dailyTotal(visitDays(response,'MLB1','7','2026-10-01','2026-10-03'),'MLB1','2026-10-01','2026-10-03','visits')).toBe(5);
  expect(()=>visitDays({...response,total_visits:6},'MLB1','7','2026-10-01','2026-10-03')).toThrow();expect(()=>visitDays({...response,item_id:'MLB2'},'MLB1','7','2026-10-01','2026-10-03')).toThrow();
 });
});
