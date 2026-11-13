export const SYNC_DAY_ZONE='America/Sao_Paulo';
export function creationDay(value:string|Date|undefined|null):string|null {
 const date=value instanceof Date?value:new Date(value??'');if(!Number.isFinite(date.getTime()))return null;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:SYNC_DAY_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const part=(key:string)=>parts.find(p=>p.type===key)!.value;return part('year')+'-'+part('month')+'-'+part('day');
}
