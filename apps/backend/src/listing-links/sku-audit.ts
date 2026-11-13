import { sellerSku } from '../mercadolivre/synchronization/seller-sku';
import { colorKey, sizeKey } from './sku-correspondence';
export function auditSku(product:any,listings:any[]){
  const alerts:Array<{severity:string;code:string;message:string;reference?:string}>=[];
  const offers=listings.flatMap(listing=>{
    const variants=listing.variants.length?listing.variants:[{id:listing.id,sku:sellerSku(listing.rawData),availableQuantity:listing.availableQuantity,attributes:listing.rawData,rawData:listing.rawData}];
    return variants.map((variant:any)=>{
      const attributes=variant.rawData?.attribute_combinations??variant.attributes?.attribute_combinations??(Array.isArray(variant.attributes)?variant.attributes:listing.rawData?.attributes??[]);
      const attr=(id:string)=>attributes.find((a:any)=>a.id===id)?.value_name??'';
      const link=listing.links.find((link:any)=>link.listingVariantId===variant.id)||(!listing.variants.length?listing.links.find((link:any)=>link.productVariantId):undefined);
      const sku=sellerSku(variant.rawData)||variant.sku||'';
      const target=product.variants.find((pv:any)=>pv.id===link?.productVariantId)||product.variants.find((pv:any)=>pv.sku===sku);
      return {reference:listing.itemId,variationId:variant.variationId??listing.itemId,sku,color:attr('COLOR'),size:attr('SIZE'),stock:variant.availableQuantity,status:listing.status,price:Number(listing.price),syncedAt:listing.lastSyncedAt??null,linked:!!link,targetSku:target?.sku??null,chart:!!listing.rawData?.attributes?.some((a:any)=>a.id==='SIZE_GRID_ID'&&(a.value_name||a.value_id))};
    });
  });
  const rows=product.variants.map((variant:any)=>{
    const matches=offers.filter(offer=>offer.targetSku===variant.sku);
    const issues:string[]=[];
    if(!matches.length){issues.push('Sem anúncio');alerts.push({severity:'warning',code:'MISSING',message:`${variant.sku}: variação sem anúncio identificado.`});}
    for(const offer of matches){
      const add=(code:string,message:string)=>{issues.push(message);alerts.push({severity:'warning',code,message:`${variant.sku}: ${message}`,reference:offer.reference});};
      if(offer.sku!==variant.sku)add('SKU','SKU diferente da Bling');
      if(offer.stock!==variant.stock)add('STOCK','Estoque diferente da Bling');
      if(offer.color&&variant.color&&colorKey(offer.color)!==colorKey(variant.color))add('COLOR','Nome da cor diferente');
      if(offer.size&&variant.size&&sizeKey(offer.size)!==sizeKey(variant.size))add('SIZE','Tamanho diferente');
      if(offer.status==='paused'&&variant.stock>0)add('PAUSED','Pausado com estoque na Bling');
      if(!offer.chart)add('CHART','Tabela de medidas não identificada no cadastro sincronizado');
    }
    const active=matches.filter(offer=>offer.status==='active');
    if(active.length>1){issues.push('Múltiplas ofertas ativas');alerts.push({severity:'info',code:'MULTIPLE',message:`${variant.sku}: ${active.length} ofertas ativas; confira se são intencionais.`});}
    return {sku:variant.sku,color:variant.color,size:variant.size,stock:variant.stock,updatedAt:variant.updatedAt,offers:matches,issues:[...new Set(issues)]};
  });
  const unmatched=offers.filter(offer=>!offer.targetSku);
  for(const offer of unmatched)alerts.push({severity:'warning',code:offer.sku?'UNMATCHED':'NO_SKU',reference:offer.reference,message:offer.sku?`SKU ${offer.sku} não corresponde a uma variação deste produto.`:'Variação sem SKU informado.'});
  return {rows,unmatched,alerts,summary:{variants:rows.length,covered:rows.filter((row:any)=>row.offers.length).length,missing:rows.filter((row:any)=>!row.offers.length).length,alerts:alerts.length},generatedAt:new Date().toISOString()};
}
