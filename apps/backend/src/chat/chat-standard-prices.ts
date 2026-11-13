import { BadRequestException } from '@nestjs/common';
export type StandardPrice={amount:number;currency_id:string;conditions:{context_restrictions:string[]}};
export function standardPrices(response:any,currency:string):StandardPrice[]{
  const rows=response?.prices?.filter((row:any)=>row.type==='standard'&&!(row.conditions?.min_purchase_unit>1));
  if(!rows?.length)throw new BadRequestException('O Mercado Livre não retornou preços padrão para este anúncio.');
  const result=rows.map((row:any)=>{
    const contexts=row.conditions?.context_restrictions;
    if(!Array.isArray(contexts)||contexts.some((value:any)=>typeof value!=='string')||row.currency_id!==currency||!Number.isFinite(row.amount)||row.amount<=0)throw new BadRequestException('Não foi possível validar a moeda e os canais de preços do anúncio.');
    return {amount:row.amount,currency_id:row.currency_id,conditions:{context_restrictions:[...contexts].sort()}};
  });
  result.sort((a:StandardPrice,b:StandardPrice)=>JSON.stringify(a.conditions).localeCompare(JSON.stringify(b.conditions)));
  if(new Set(result.map((row:StandardPrice)=>JSON.stringify(row.conditions))).size!==result.length)throw new BadRequestException('O anúncio retornou canais de preços duplicados.');
  return result;
}
export function proposedPrices(rows:StandardPrice[],amount:number){
  let marketplace=false;
  const result=rows.map(row=>{
    const selected=!row.conditions.context_restrictions.length||row.conditions.context_restrictions.includes('channel_marketplace');
    if(selected)marketplace=true;
    return {...row,amount:selected?amount:row.amount};
  });
  if(!marketplace)throw new BadRequestException('O anúncio não possui preço padrão no canal Mercado Livre.');
  return result;
}
export function withoutPrice(body:Record<string,any>){
  const {price,...result}=body;
  if(result.variations){result.variations=result.variations.map((row:any)=>{const {price,...other}=row;return other;});if(result.variations.every((row:any)=>Object.keys(row).every(key=>key==='id')))delete result.variations;}
  return result;
}
