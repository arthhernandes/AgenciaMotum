type CatalogRow={id:string;blingAccountId:string|null;sku:string;_count:{links:number};variants:Array<{sku:string;color:string|null;size:string|null;_count:{links:number}}>};
// Only suppress empty parent placeholders beside a genuine grade in the same account.
// A separately linked simple product remains visible for review.
export function parentPlaceholderIds(rows:CatalogRow[]):string[]{
  const grades=new Set(rows.filter(row=>row.blingAccountId&&row.variants.some(variant=>variant.sku!==row.sku&&!!variant.color&&!!variant.size)).map(row=>JSON.stringify([row.blingAccountId,row.sku])));
  return rows.filter(row=>grades.has(JSON.stringify([row.blingAccountId,row.sku]))&&row._count.links===0&&row.variants.length<=1&&row.variants.every(variant=>variant.sku===row.sku&&!variant.color&&!variant.size&&variant._count.links===0)).map(row=>row.id);
}
