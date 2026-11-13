import { allocate } from './profitability-calculation';
import { dailyTotal, DailyMetrics } from './daily-metrics';

export type AdvertisingPeriod={from:string;to:string;note?:string;campaignId?:string;campaignName?:string;startedAt?:string;endedAt?:string;intervalId?:string;estimated?:boolean;ambiguousBoundary?:boolean;ambiguousDays?:string[]};
export function reportAdvertisingPeriods(periods:AdvertisingPeriod[],from:string,to:string){
  return periods.map(period=>({...period,from:period.from<from?from:period.from,to:period.to>to?to:period.to,ambiguousBoundary:period.ambiguousBoundary&&(!period.ambiguousDays||period.ambiguousDays.some(day=>day>=from&&day<=to)),note:'Rateio limitado ao período selecionado no relatório. '+(period.note??'')})).filter(period=>period.from<=period.to);
}
const saleDay=(row:any)=>{const time=Date.parse(row.createdAt);return Number.isFinite(time)?new Date(time-3*3600000).toISOString().slice(0,10):null;};

/** Complete provider expense inventory: absent items have no recorded expense in that period. */
export function confirmPeriodAdvertising(rows:any[],allocations:any[],inventory:any,sellerId:string,from:string,to:string,ordersComplete:boolean){
  if(inventory?.complete!==true||inventory.scope!=='all_ads'||inventory.sellerId!==sellerId||inventory.dateFrom!==from||inventory.dateTo!==to||!Array.isArray(inventory.costs))return allocations;
  const costs=new Map<string,any>();for(const entry of inventory.costs){if(!/^MLB\d+$/.test(entry.itemId)||costs.has(entry.itemId)||!Number.isSafeInteger(entry.costCents)||entry.costCents<0)return allocations;costs.set(entry.itemId,entry);}
  const rowByKey=new Map(rows.map(row=>[row.orderId+':'+row.itemIndex,row]));
  const unresolved=new Set<string>(allocations.filter(row=>row.cost===null).map(row=>rowByKey.get(row.orderId+':'+row.itemIndex)?.itemId).filter(Boolean));
  const replacements=new Map<string,any>();
  for(const itemId of unresolved){
    const entry=costs.get(itemId),total=entry?.costCents??0;
    if(total>0&&!ordersComplete)continue;
    const sales=rows.filter(row=>row.itemId===itemId).sort((a,b)=>String(a.orderId).localeCompare(String(b.orderId))||a.itemIndex-b.itemIndex),orders=[...new Set<string>(sales.map(row=>String(row.orderId)))];
    if(!orders.length)continue;
    const parts=allocate(total,orders.map(()=>1));
    orders.forEach((orderId,i)=>{const lines=sales.filter(row=>String(row.orderId)===orderId),split=allocate(parts[i],lines.map(()=>1));lines.forEach((row,j)=>{
      replacements.set(row.orderId+':'+row.itemIndex,{orderId:row.orderId,itemIndex:row.itemIndex,cost:split[j]/100,activeFrom:from,activeTo:to,orders:total?orders.length:undefined,periodCost:total/100,campaignId:entry?.campaignId,source:'Product Ads · gasto confirmado no período',message:null,basis:'confirmed_period_report',note:total?'Gasto do anúncio confirmado no relatório completo do Mercado Livre. Como o vínculo histórico da campanha não está disponível, o rateio usa todas as vendas desse anúncio no período selecionado.':'Sem registro de gasto para o anúncio no relatório completo do Mercado Livre para este período.',checkedAt:inventory.checkedAt});
    });});
  }
  return allocations.map(row=>replacements.get(row.orderId+':'+row.itemIndex)??row);
}

/** All paid sales of each active interval must be supplied, independently of the report filter. */
export function allocateActiveAdvertising(rows:any[],metrics:Map<string,DailyMetrics>,sellerId:string,complete:(itemId:string,period:AdvertisingPeriod)=>boolean,periods:Map<string,AdvertisingPeriod[]>){
  const results:any[]=[],groups=new Map<string,any[]>();
  for(const row of rows){const group=groups.get(row.itemId)??[];group.push({...row,day:saleDay(row)});groups.set(row.itemId,group);}
  for(const [itemId,group] of groups){
    group.sort((a,b)=>String(a.orderId).localeCompare(String(b.orderId))||a.itemIndex-b.itemIndex);
    const data=metrics.get(itemId),ranges=periods.get(itemId)??[],assigned=new Set<any>();
    for(const period of ranges){
      const sales=group.filter(row=>!assigned.has(row)&&row.day&&row.day>=period.from&&row.day<=period.to&&(!period.startedAt||Date.parse(row.createdAt)>=Date.parse(period.startedAt))&&(!period.endedAt||Date.parse(row.createdAt)<Date.parse(period.endedAt)));
      const total=data?.sellerId===sellerId?dailyTotal(data,itemId,period.from,period.to,'BRL_CENTS'):null;
      const valid=total!==null&&!period.ambiguousBoundary&&complete(itemId,period);
      const orders=[...new Set<string>(sales.map(row=>String(row.orderId)))],parts=valid&&orders.length?allocate(total!,orders.map(()=>1)):[];
      orders.forEach((orderId,index)=>{
        const lines=sales.filter(row=>String(row.orderId)===orderId),lineParts=valid?allocate(parts[index],lines.map(()=>1)):[];
        lines.forEach((row,line)=>{assigned.add(row);results.push({orderId:row.orderId,itemIndex:row.itemIndex,cost:valid?lineParts[line]/100:null,day:row.day,activeFrom:period.from,activeTo:period.to,orders:orders.length,periodCost:total===null?null:total/100,campaignId:period.campaignId,campaignName:period.campaignName,note:period.note,source:valid?'Product Ads · período ativo':null,message:valid?null:total===null?'Campanha identificada. O histórico de gastos não cobre todo o intervalo necessário ao rateio.':'Campanha identificada. Faltam vendas no histórico para calcular a divisão com segurança.'});});
      });
    }
    for(const row of group)if(!assigned.has(row)){
      const zero=row.day&&data?.sellerId===sellerId&&dailyTotal(data,itemId,row.day,row.day,'BRL_CENTS')===0;
      results.push({orderId:row.orderId,itemIndex:row.itemIndex,cost:zero?0:null,day:row.day,source:zero?'Product Ads · período ativo':null,message:zero?null:'Período ativo de publicidade ainda não confirmado.'});
    }
  }
  return results;
}
