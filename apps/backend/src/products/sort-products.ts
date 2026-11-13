export function productAnnouncementCount(product:any):number{
 const links=[...(product.links??[]),...(product.variants??[]).flatMap((variant:any)=>variant.links??[])];
 return new Set(links.filter(link=>link.listing).map(({listing})=>{
  const family=listing.rawData?.family_id;
  return `${listing.marketplaceAccountId}:${family?`family:${family}`:`item:${listing.itemId||listing.id}`}`;
 })).size;
}
export function sortProductsByAnnouncements<T extends {id:string;sku:string}>(products:T[],direction:'asc'|'desc'):T[]{
 const counts=new Map(products.map(product=>[product.id,productAnnouncementCount(product)]));
 return [...products].sort((a,b)=>(counts.get(a.id)!-counts.get(b.id)!)*(direction==='desc'?-1:1)||a.sku.localeCompare(b.sku,'pt-BR',{numeric:true})||a.id.localeCompare(b.id));
}
