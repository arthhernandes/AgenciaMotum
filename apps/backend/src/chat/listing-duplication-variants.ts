import { BadRequestException } from '@nestjs/common';
import { skuListingDimensions } from '../listing-links/sku-listing-dimensions';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';

export function duplicationVariantOptions(rows:any[]){
  return rows.flatMap(row=>(row.body.variations?.length?row.body.variations:[row.body]).map((variant:any,index:number)=>{
    const legacy=!!row.body.variations?.length;
    const variationId=legacy?String(row.variations[index].id):row.sourceVariationId;
    const dimensions=skuListingDimensions({attributes:[...(variant.attribute_combinations??[]),...(variant.attributes??[]),...(row.body.attributes??[])]});
    const ids=legacy?variant.picture_ids:row.body.pictures.map((p:any)=>p.id);
    return {offerKey:row.reference+(row.sourceVariationId?':'+row.sourceVariationId:''),key:row.reference+(variationId?':'+variationId:''),reference:row.reference,sourceVariationId:variationId??null,sku:legacy?sellerSku(row.variations[index]):row.sku,...dimensions,pictures:(ids??[]).map((id:string)=>({id,url:`https://http2.mlstatic.com/D_${id}-O.jpg`}))};
  }));
}
export function selectDuplicationVariants(rows:any[],selected?:Array<{key:string;photos?:string[]}>){
  if(!selected)return rows;
  const options=duplicationVariantOptions(rows),keys=new Set(options.map(option=>option.key)),selection=new Map(selected.map(entry=>[entry.key,entry]));
  if(!selected.length||selected.length>500||selection.size!==selected.length||selected.some(entry=>!keys.has(entry.key)))throw new BadRequestException('Selecione variações válidas do anúncio, sem repetições.');
  for(const entry of selected)if(entry.photos&&(!entry.photos.length||entry.photos.length>12||new Set(entry.photos).size!==entry.photos.length||entry.photos.some(id=>!(/^[\w-]{1,150}$/).test(id))))throw new BadRequestException('Cada variação precisa de 1 a 12 fotos válidas, sem repetições.');
  return rows.flatMap(source=>{
    const row=structuredClone(source),legacy=!!row.body.variations?.length;
    if(!legacy){const key=row.reference+(row.sourceVariationId?':'+row.sourceVariationId:'');const choice=selection.get(key);if(!choice)return [];if(choice.photos)row.body.pictures=choice.photos.map(id=>({id}));return [row];}
    const kept=row.body.variations.map((variant:any,i:number)=>({body:variant,source:row.variations[i],choice:selection.get(row.reference+':'+row.variations[i].id)})).filter((entry:any)=>entry.choice);
    if(!kept.length)return [];
    row.variations=kept.map((entry:any)=>entry.source);
    row.body.variations=kept.map((entry:any)=>({...entry.body,picture_ids:entry.choice.photos??entry.body.picture_ids}));
    row.body.pictures=[...new Set<string>(row.body.variations.flatMap((v:any)=>v.picture_ids))].map(id=>({id}));
    return [row];
  });
}
