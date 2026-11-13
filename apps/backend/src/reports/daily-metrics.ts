export type DailyMetrics = {
  itemId:string;sellerId:string;unit:'visits'|'BRL_CENTS';
  values:Record<string,number>;coverage:Array<{from:string;to:string}>;checkedAt:string;
};
export const shiftDay=(day:string,days:number)=>new Date(Date.parse(day)+days*86400000).toISOString().slice(0,10);
/** Resume only gaps. A one-day overlap closes the previously partial collection day. */
export function missingDailyRanges(data:DailyMetrics|undefined,from:string,to:string,unit:DailyMetrics['unit']){
  if(data&&dailyTotal(data,data.itemId,from,to,unit)!==null)return [];
  const ranges:Array<{from:string;to:string}>=[];let end:string|undefined;
  for(let day=to;day>=from;day=shiftDay(day,-1)){
    const missing=!data||dailyTotal(data,data.itemId,day,day,unit)===null;
    if(missing){end??=day;if((Date.parse(end)-Date.parse(day))/86400000>=148||day===from){ranges.push({from:day>from?shiftDay(day,-1):day,to:end});end=undefined;}}
    else if(end){ranges.push({from:day,to:end});end=undefined;}
  }
  return ranges.map(r=>r.from===r.to?(r.to<to?{from:r.from,to:shiftDay(r.to,1)}:{from:shiftDay(r.from,-1),to:r.to}):r);
}
const validDay=(day:unknown):day is string=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day;
/** Null means missing coverage, never a fabricated zero. Sparse dates inside confirmed coverage are zero. */
export function dailyTotal(data:DailyMetrics|undefined,itemId:string,from:string,to:string,unit:DailyMetrics['unit']):number|null {
  if(!data||data.itemId!==itemId||data.unit!==unit||!validDay(from)||!validDay(to)||from>to||!Array.isArray(data.coverage)||!data.values)return null;
  const ranges=data.coverage.filter(r=>validDay(r.from)&&validDay(r.to)&&r.from<=r.to).sort((a,b)=>a.from.localeCompare(b.from));
  let next=from;
  for(const range of ranges){if(range.from>next)break;if(range.to>=next)next=shiftDay(range.to,1);if(next>to)break;}
  if(next<=to)return null;
  let total=0;
  for(let day=from;day<=to;day=shiftDay(day,1)){const value=data.values[day]??0;if(!Number.isSafeInteger(value)||value<0)return null;total+=value;if(!Number.isSafeInteger(total))return null;}
  return total;
}
export function mergeDaily(previous:DailyMetrics|undefined,next:DailyMetrics):DailyMetrics {
  if(previous&&(previous.itemId!==next.itemId||previous.sellerId!==next.sellerId||previous.unit!==next.unit))throw Error('Métricas de contas ou anúncios diferentes.');
  const values={...previous?.values};
  // Replacing a range must also remove old nonzero dates that the provider now reports as zero.
  for(const day of Object.keys(values))if(next.coverage.some(r=>r.from<=day&&day<=r.to))delete values[day];
  Object.assign(values,next.values);
  const ranges=[...previous?.coverage??[],...next.coverage].sort((a,b)=>a.from.localeCompare(b.from));
  const coverage:DailyMetrics['coverage']=[];
  for(const r of ranges){const last=coverage[coverage.length-1];if(last&&r.from<=shiftDay(last.to,1)){if(r.to>last.to)last.to=r.to;}else coverage.push({...r});}
  return {...next,values,coverage};
}
export function visitDays(response:any,itemId:string,sellerId:string,from:string,to:string):DailyMetrics {
  if(response?.item_id!==itemId||response.date_from?.slice(0,10)!==from||response.date_to?.slice(0,10)!==to||!Number.isSafeInteger(response.total_visits)||response.total_visits<0||!Array.isArray(response.results))throw Error('Intervalo de visitas não confirmado.');
  const values:Record<string,number>={};let total=0;
  for(const row of response.results){const day=row.date?.slice(0,10);if(!validDay(day)||day<from||day>to||day in values||!Number.isSafeInteger(row.total)||row.total<0)throw Error('Série diária de visitas inválida.');values[day]=row.total;total+=row.total;}
  if(total!==response.total_visits)throw Error('Total de visitas diferente da série diária.');
  return {itemId,sellerId,unit:'visits',values,coverage:[{from,to}],checkedAt:new Date().toISOString()};
}
/** A freshly confirmed retained total equal to the known daily sum proves the remaining days are zero. */
export function coverVisitsFromTotal(data:DailyMetrics,from:string,to:string,total:number):DailyMetrics|null {
  if(data.unit!=='visits'||!validDay(from)||!validDay(to)||from>to||!Number.isSafeInteger(total)||total<0)return null;
  let known=0;const values:Record<string,number>={};
  for(const [day,value] of Object.entries(data.values))if(day>=from&&day<=to){
    if(!validDay(day)||!Number.isSafeInteger(value)||value<0||dailyTotal(data,data.itemId,day,day,'visits')!==value)return null;
    known+=value;values[day]=value;
  }
  if(known!==total||!Number.isSafeInteger(known))return null;
  return mergeDaily(data,{...data,values,coverage:[{from,to}],checkedAt:new Date().toISOString()});
}
