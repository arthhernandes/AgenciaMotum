import { AdvertisingPeriod } from './advertising-allocation';

export type AdMembership={itemId:string;campaignId:string|null;campaignName?:string;active:boolean;status:string;estimatedFrom?:string};
export type AdInterval={id:string;campaignId:string;campaignName?:string;startedAt:string;endedAt?:string;startAfter:string|null;endAfter?:string;leftCensored:boolean;endReason?:string;estimatedFrom?:string};
export type AdHistory={firstObservedAt:string;lastObservedAt:string;current:AdMembership;intervals:AdInterval[];events:Array<{at:string;after:string;reason:string;from:AdMembership;to:AdMembership}>};
export type MembershipHistory={version:1;sellerId:string;firstObservedAt:string;lastObservedAt:string;items:Record<string,AdHistory>};
export const adDay=(value:string)=>new Date(Date.parse(value)-3*3600000).toISOString().slice(0,10);
const localTime=(value:string|null|undefined)=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'o início do acompanhamento';

/** A failed/partial provider response must never call this reducer. Closed intervals are immutable. */
export function observeMemberships(previous:MembershipHistory|undefined,sellerId:string,members:AdMembership[],at:string,unknownIds:string[]=[]):MembershipHistory{
  if(previous&&previous.sellerId!==sellerId)throw Error('Histórico de outro vendedor.');
  if(!Number.isFinite(Date.parse(at)))throw Error('Data de observação inválida.');
  if(previous&&at<=previous.lastObservedAt)return previous;
  const seen=new Map<string,AdMembership>();
  for(const member of members){if(!/^MLB\d+$/.test(member.itemId)||seen.has(member.itemId)||member.active&&!/^\d+$/.test(member.campaignId??''))throw Error('Vínculo publicitário inválido ou duplicado.');seen.set(member.itemId,member);}
  const next:MembershipHistory=previous?JSON.parse(JSON.stringify(previous)):{version:1,sellerId,firstObservedAt:at,lastObservedAt:at,items:{}};
  for(const itemId of new Set([...Object.keys(next.items),...seen.keys()])){
    if(unknownIds.includes(itemId))continue;
    const member=seen.get(itemId)??{itemId,campaignId:null,active:false,status:'removed'},old=next.items[itemId];
    if(!old){next.items[itemId]={firstObservedAt:at,lastObservedAt:at,current:member,intervals:member.active?[{id:itemId+'|'+at,campaignId:member.campaignId!,campaignName:member.campaignName,startedAt:at,startAfter:null,leftCensored:true,estimatedFrom:member.estimatedFrom}]:[],events:[]};continue;}
    const changed=old.current.active!==member.active||old.current.campaignId!==member.campaignId;
    if(changed){
      const reason=member.status==='removed'||!member.campaignId?'removed':old.current.campaignId!==member.campaignId?'campaign_changed':member.active?'resumed':'paused';
      const open=old.intervals.find(interval=>!interval.endedAt);
      if(open){open.endedAt=at;open.endAfter=old.lastObservedAt;open.endReason=reason;}
      old.events.push({at,after:old.lastObservedAt,reason,from:old.current,to:member});
      if(member.active)old.intervals.push({id:itemId+'|'+at,campaignId:member.campaignId!,campaignName:member.campaignName,startedAt:at,startAfter:old.lastObservedAt,leftCensored:false});
    }
    old.current=member;old.lastObservedAt=at;
  }
  next.lastObservedAt=at;return next;
}

/** Legacy inferred dates are used only before observation; they cannot reopen a closed interval. */
export function membershipPeriods(history:MembershipHistory|undefined,itemId:string,legacy:AdvertisingPeriod[]):AdvertisingPeriod[]{
  const item=history?.items[itemId];if(!item)return legacy;
  const baselineDay=adDay(item.firstObservedAt),lastDay=adDay(item.lastObservedAt);
  const legacyTo=new Date(Date.parse(baselineDay)-86400000).toISOString().slice(0,10);
  const tracked:AdvertisingPeriod[]=item.intervals.map(interval=>{
    const prior=interval.leftCensored?legacy.find(period=>period.campaignId===interval.campaignId&&period.from<=baselineDay&&period.to>=baselineDay):undefined;
    const inferred=interval.estimatedFrom??prior?.from;
    let from=inferred??adDay(interval.startedAt);const to=interval.endedAt?adDay(interval.endedAt):lastDay;
    if(interval.leftCensored)for(const prior of legacy){
      if(prior.campaignId===interval.campaignId)continue;
      const end=prior.to<legacyTo?prior.to:legacyTo;
      if(prior.from<=end&&end>=from)from=new Date(Date.parse(end)+86400000).toISOString().slice(0,10);
    }
    const note=interval.leftCensored?'Início anterior ao acompanhamento estimado. ':'Entrada detectada entre '+localTime(interval.startAfter)+' e '+localTime(interval.startedAt)+'. ';
    return {from,to,campaignId:interval.campaignId,campaignName:interval.campaignName,startedAt:inferred?undefined:interval.startedAt,endedAt:interval.endedAt,intervalId:interval.id,note:note+(interval.endedAt?'Saída detectada entre '+localTime(interval.endAfter)+' e '+localTime(interval.endedAt)+'. Intervalo encerrado.':'Vínculo ativo na última consulta de '+localTime(item.lastObservedAt)+'.'),estimated:true};
  });
  const mergedLegacy=legacy.filter(period=>!tracked.some(interval=>interval.campaignId===period.campaignId&&period.to>=interval.from&&period.from<=interval.to)).map(period=>({...period,to:period.to<legacyTo?period.to:legacyTo})).filter(period=>period.from<=period.to);
  // Daily provider metrics cannot safely separate two campaign intervals on the same day.
  for(const a of tracked)for(const b of tracked)if(a!==b&&a.from<=b.to&&b.from<=a.to){
    a.ambiguousBoundary=true;a.note+=' Há troca ou retomada no mesmo dia; gasto diário não separável entre intervalos.';
    const days=new Set(a.ambiguousDays);for(let time=Date.parse(a.from>b.from?a.from:b.from);time<=Date.parse(a.to<b.to?a.to:b.to);time+=86400000)days.add(new Date(time).toISOString().slice(0,10));a.ambiguousDays=[...days];
  }
  return [...mergedLegacy,...tracked];
}
