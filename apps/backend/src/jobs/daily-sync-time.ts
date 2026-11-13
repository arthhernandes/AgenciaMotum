export const DAILY_SYNC_ZONE='America/Sao_Paulo';
export function localSyncParts(date:Date){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:DAILY_SYNC_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const get=(type:string)=>parts.find(part=>part.type===type)!.value;
 return {day:`${get('year')}-${get('month')}-${get('day')}`,hour:Number(get('hour')),minute:Number(get('minute'))};
}
export function nextDailySync(now:Date):Date{
 const local=localSyncParts(now);const day=new Date(local.day+'T00:00:00Z');if(local.hour>=6)day.setUTCDate(day.getUTCDate()+1);
 const desired=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),6);
 let candidate=desired;
 for(let attempt=0;attempt<2;attempt++){const parts=localSyncParts(new Date(candidate));candidate+=desired-Date.parse(parts.day+`T${String(parts.hour).padStart(2,'0')}:${String(parts.minute).padStart(2,'0')}:00Z`);}
 return new Date(candidate);
}
