export type ProfitSort={field:string;direction:'asc'|'desc'};
/** Sort raw amounts before pagination; absent values stay last in either direction. */
export function sortProfitRows<T>(rows:T[],sort:ProfitSort|null):T[]{
  if(!sort)return rows;
  const value=(row:any)=>{
    const raw=sort.field==='createdAt'?Date.parse(row.createdAt):sort.field.split('.').reduce((current,key)=>current?.[key],row);
    return typeof raw==='number'&&Number.isFinite(raw)?raw:null;
  };
  return [...rows].sort((a,b)=>{
    const left=value(a),right=value(b);
    if(left===null)return right===null?0:1;
    if(right===null)return -1;
    return sort.direction==='desc'?right-left:left-right;
  });
}
