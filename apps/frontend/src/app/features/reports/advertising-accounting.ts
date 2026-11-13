/** Only manual attribution or the same-item active campaign allocation is accepted. */
export function orderAdvertising(row:any):number|null {
  return row.advertisingSource==='Manual'||row.advertisingSource==='Product Ads · período ativo'||row.advertisingSource==='Product Ads · gasto confirmado no período'?row.advertisingCost??null:null;
}

export function periodAdvertisingResult(rows:any[],cost:number|null,complete:boolean){
  if(!rows.length||rows.some(row=>typeof row.netProfit!=='number'||!Number.isFinite(row.netProfit)))return {before:null,after:null};
  // Add back attributed expenses before subtracting the account total once.
  const before=rows.reduce((sum,row)=>sum+Math.round(row.netProfit*100)+Math.round((orderAdvertising(row)??0)*100),0);
  return {before:before/100,after:complete&&typeof cost==='number'&&Number.isFinite(cost)&&cost>=0?(before-Math.round(cost*100))/100:null};
}
