export const VARIATION_BATCH_SIZE = 20;
export const MAX_VARIATION_SELECTION = 1000;
export type VariationBatchProgress = {size:number;total:number;completed:number;confirmedSkus:string[]};
export function publicationBatchIndices(rows:Array<{status:string}>):number[]{
  const priority=(status:string)=>status==='QUEUED'?0:['PUBLISHED_NO_STOCK','NO_STOCK'].includes(status)?2:1;
  return rows.map((_,index)=>index).filter(index=>!['ACTIVE','FAILED'].includes(rows[index].status)).sort((a,b)=>priority(rows[a].status)-priority(rows[b].status)||a-b).slice(0,VARIATION_BATCH_SIZE);
}
