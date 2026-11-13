import { sameSize } from '../listing-links/sku-correspondence';
export function variantSizeValue(size:string,attributes:any[]):{id:string|null;name:string}{
  const candidates=(attributes.find(attribute=>attribute.id==='SIZE')?.values??[]).filter((value:any)=>sameSize(value.name,size));
  const official=candidates.find((value:any)=>value.id!=null&&String(value.id).trim());
  if(official)return {id:String(official.id),name:official.name};
  if(candidates.length)return {id:null,name:candidates[0].name};
  const clean=size.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
  return {id:null,name:clean==='UNICO'?'Único':size.trim()};
}
