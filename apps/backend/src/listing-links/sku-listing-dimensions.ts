/** Read explicit marketplace attributes; never infer size from title or color. */
export function skuListingDimensions(variant:any):{color:string;size:string}{
 const attributes=[...(variant.attribute_combinations??[]),...(variant.attributes??[])];
 const value=(ids:string[])=>{
  for(const id of ids){for(const attribute of attributes.filter((entry:any)=>entry.id===id)){
   const direct=typeof attribute.value_name==='string'?attribute.value_name.trim():'';
   if(direct&&!/^(?:n\/a|não informado|nao informado|não se aplica|nao se aplica)$/i.test(direct))return direct;
   const names=[...new Set<string>((attribute.values??[]).map((entry:any)=>typeof entry.name==='string'?entry.name.trim():'').filter(Boolean))];
   if(names.length===1)return names[0];
  }}return '';
 };
 return {color:value(['COLOR']),size:value(['SIZE','APPAREL_SIZE','SHOE_SIZE','ALPHANUMERIC_SIZE','CLOTHING_LOT_SIZE'])};
}
