export function sortListingGroups<T extends {id:string;availableQuantity:number;soldQuantity:number;price:any}>(groups:T[],sortBy?:'stock'|'sold'|'price',direction:'asc'|'desc'='desc'):T[]{
  if(!sortBy)return groups;
  const field=({stock:'availableQuantity',sold:'soldQuantity',price:'price'} as const)[sortBy];
  const multiplier=direction==='asc'?1:-1;
  return [...groups].sort((a,b)=>multiplier*(Number(a[field])-Number(b[field]))||a.id.localeCompare(b.id));
}
