import { DailyMetrics, missingDailyRanges, shiftDay } from './daily-metrics';

/** Recheck three recent ad days for delayed metrics. New MLBs still need a retained-history backfill. */
export function advertisingImportFrom(archives:DailyMetrics[],from:string,to:string){
  if(!archives.length)return from;
  const starts=archives.flatMap(data=>missingDailyRanges(data,from,to,'BRL_CENTS').map(range=>range.from));
  const latest=archives.flatMap(data=>data.coverage.filter(r=>r.from<=to&&r.to>=from).map(r=>r.to<to?r.to:to)).sort().at(-1);
  const refreshFrom=latest?shiftDay(latest,-2):from;
  return [from,[...starts,refreshFrom].sort()[0]].sort().at(-1)!;
}

/** Reconcile recent orders (status/refunds can change), and import every uncovered older day. */
export function orderImportRanges(from:string,to:string,completedDates:string[],refreshDays=7){
  if(!Number.isInteger(refreshDays)||refreshDays<0||refreshDays>90)throw Error('Informe de 0 a 90 dias para a revisão recente.');
  const complete=new Set(completedDates.filter(day=>day>=from&&day<=to)),latest=[...complete].sort().at(-1);
  const refreshFrom=latest&&refreshDays?shiftDay(latest,1-refreshDays):shiftDay(to,1);
  const result:Array<{from:string;to:string}>=[];let start:string|undefined;
  for(let day=from;day<=to;day=shiftDay(day,1)){
    const needed=!complete.has(day)||day>=refreshFrom;
    if(needed)start??=day;
    if(start&&(!needed||day===to)){result.push({from:start,to:needed?day:shiftDay(day,-1)});start=undefined;}
  }
  return result;
}
