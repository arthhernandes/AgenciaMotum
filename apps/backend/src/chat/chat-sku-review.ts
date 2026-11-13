import { matchesCatalogSku } from '../common/catalog-search';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';
export function skuReview(sku:string,products:any[],groups:any[],includeMissing=false){
 const catalog=new Map<string,any>(products.flatMap(product=>product.variants.map((variant:any)=>[variant.sku,{...variant,title:product.title}])));
 const previews:any[]=[];
 for(const group of groups){
  const familyRows:any[]=[];let firstChild:any;
  for(const child of group.children??[]){
  const variants=child.variants?.length?child.variants:[{sku:sellerSku(child.rawData),attributes:child.rawData}];
  const matching=variants.filter((variant:any)=>matchesCatalogSku(variant.sku,sku));
  if(!matching.length)continue;
  const rows=matching.map((variant:any)=>{const product=catalog.get(variant.sku);const attributes=Array.isArray(variant.attributes)?variant.attributes:variant.attributes?.attribute_combinations??variant.rawData?.attribute_combinations??[];const size=attributes.find((attribute:any)=>attribute.id==='SIZE')?.value_name??product?.size??'';const color=attributes.find((attribute:any)=>attribute.id==='COLOR')?.value_name??product?.color??'';return {mlb:child.itemId,size,color,field:`${color} · Tamanho ${size}`,before:String(variant.sku),after:product?`${product.sku} · ${product.color??''} · ${product.size??''}`:'Não encontrado na Bling'};});
  familyRows.push(...rows);firstChild??=child;
  }
  if(!familyRows.length)continue;
  const presentSkus=new Set(familyRows.map(row=>row.before));
  if(includeMissing)for(const [catalogSku,product] of catalog)if(matchesCatalogSku(catalogSku,sku)&&!presentSkus.has(catalogSku))familyRows.push({mlb:'—',sku:catalogSku,missing:true,size:product.size??'',color:product.color??'',field:`${product.color??''} · Tamanho ${product.size??''}`,before:'Sem oferta no anúncio',after:`${catalogSku} · ${product.color??''} · ${product.size??''}`});
  familyRows.sort((a:any,b:any)=>a.color.localeCompare(b.color,'pt-BR')||(['P','M','G','GG','XXG'].indexOf(a.size)+1||100)-(['P','M','G','GG','XXG'].indexOf(b.size)+1||100));
  previews.push({correspondence:true,missingReview:includeMissing,reference:firstChild.itemId,baseSku:sku,presentCount:presentSkus.size,mlb:group.familyId?`Família ${group.familyId}`:firstChild.itemId,title:group.title??firstChild.title??catalog.get(familyRows[0].before)?.title,account:'Mercado Livre',fields:familyRows.map(({mlb,sku,missing,field,before,after}:any)=>({mlb,...(missing?{sku,missing:true}:{}),field,before,after})),notes:[]});
 }
 return previews;
}
