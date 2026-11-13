export function cents(value:unknown):number|null {
  if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value)))return null;
  const amount=Number(value);if(!Number.isFinite(amount)||amount<0)return null;
  const result=Math.round((amount+Number.EPSILON)*100);return Number.isSafeInteger(result)?result:null;
}
export const money=(value:number|null)=>value===null?null:value/100;

/** Largest remainder allocation: the allocated cents always equal the original charge. */
export function allocate(total:number,weights:number[]):number[]{
  if(!Number.isSafeInteger(total)||total<0||!weights.length||weights.some(w=>!Number.isSafeInteger(w)||w<0))throw Error('Invalid allocation');
  const sum=weights.reduce((a,b)=>a+b,0),denominator=sum||weights.length;
  const raw=weights.map(w=>total*(sum?w:1)/denominator),parts=raw.map(Math.floor);
  const sorted=raw.map((value,index)=>({index,remainder:value-parts[index]})).sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
  for(let remaining=total-parts.reduce((a,b)=>a+b,0),i=0;remaining>0;remaining--,i++)parts[sorted[i%sorted.length].index]++;
  return parts;
}
export function profitability(revenue:number|null,fee:number|null,shipping:number|null,acquisition:number|null,taxes:number|null,eligible=true){
  const beforeTax=[revenue,fee,shipping,acquisition].every(v=>v!==null)?revenue!-fee!-shipping!-acquisition!:null;
  const total=[fee,shipping,acquisition,taxes].every(v=>v!==null)?fee!+shipping!+acquisition!+taxes!:null;
  const profit=eligible&&revenue!==null&&total!==null?revenue-total:null;
  return {operatingCost:money(total),profitBeforeTaxes:eligible?money(beforeTax):null,netProfit:money(profit),netMargin:profit!==null&&revenue!>0?Math.round(profit/revenue!*10000)/100:null};
}
