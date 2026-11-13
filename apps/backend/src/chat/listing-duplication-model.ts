import { BadRequestException } from '@nestjs/common';

export const titleKey=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g,' ').trim();
export function duplicationTitles(values:unknown,original:string,max:number){
  if(!Array.isArray(values)||!values.length||values.length>10)throw new BadRequestException('Escolha de 1 a 10 cópias.');
  const seen=new Set([titleKey(original)]);
  return values.map(value=>{
    if(typeof value!=='string')throw new BadRequestException('Informe os títulos das cópias.');
    const title=value.trim().replace(/\s+/g,' '),key=titleKey(title);
    if(title.length<5||title.length>max||!key)throw new BadRequestException(`Cada título deve ter de 5 a ${max} caracteres.`);
    if(seen.has(key))throw new BadRequestException('Use títulos diferentes entre si e do anúncio original.');
    seen.add(key);return title;
  });
}
export function copyItemBody(item:any,title:string,userProducts:boolean,warehouse:boolean,readOnly:string[]=[]){
  if(item.shipping?.logistic_type==='fulfillment')throw new BadRequestException('Este anúncio usa o Full. A cópia exige uma configuração de estoque Full própria.');
  if(item.catalog_listing)throw new BadRequestException('Este anúncio é de catálogo; o Mercado Livre define seu título. Selecione um anúncio próprio para gerar títulos por IA.');
  if(!['active','paused'].includes(item.status))throw new BadRequestException(`O anúncio ${item.id} precisa estar ativo ou pausado para ser copiado.`);
  if(!item.pictures?.length||!item.category_id||item.currency_id!=='BRL'||!(item.price>0))throw new BadRequestException(`O anúncio ${item.id} está sem fotos, categoria ou preço válido.`);
  const attrs=(values:any[]=[])=>values.filter(a=>!readOnly.includes(a.id)).map(a=>({...(a.id?{id:a.id}:{name:a.name}),...(a.value_id!=null&&String(a.value_id).trim()!==''?{value_id:a.value_id,...(a.value_name!=null?{value_name:a.value_name}:{})}:a.value_name!=null?{value_name:a.value_name}:a.values?.length?{values:a.values.map((v:any)=>({id:v.id!=null&&String(v.id).trim()!==''?v.id:null,name:v.name??null}))}:{})}));
  const body:any={category_id:item.category_id,currency_id:item.currency_id,buying_mode:item.buying_mode??'buy_it_now',listing_type_id:item.listing_type_id,condition:item.condition,price:item.price,available_quantity:warehouse?0:item.available_quantity??0,pictures:item.pictures.map((p:any)=>({id:p.id})),attributes:attrs(item.attributes),sale_terms:attrs(item.sale_terms),[userProducts?'family_name':'title']:title};
  if(item.shipping)body.shipping=Object.fromEntries(['mode','local_pick_up','free_shipping','dimensions','methods','costs'].filter(key=>item.shipping[key]!=null).map(key=>[key,item.shipping[key]]));
  if(item.official_store_id!=null)body.official_store_id=item.official_store_id;
  if(item.channels?.length)body.channels=item.channels;
  if(item.variations?.length){
    if(userProducts)throw new BadRequestException('O vendedor usa User Products e o modelo ainda possui variações tradicionais. Conclua a migração do anúncio antes de copiar.');
    body.variations=item.variations.map((v:any)=>({price:v.price??item.price,available_quantity:v.available_quantity??0,attribute_combinations:attrs(v.attribute_combinations),attributes:attrs(v.attributes),picture_ids:v.picture_ids??item.pictures.map((p:any)=>p.id),...(v.seller_custom_field?{seller_custom_field:v.seller_custom_field}:{})}));
    delete body.available_quantity;
  }
  return body;
}
export function duplicationError(error:any){
  const status=error?.response?.status,codes=(error?.response?.data?.cause??[]).filter((c:any)=>c.type!=='warning').map((c:any)=>c.code).filter((code:any)=>typeof code==='string'&&/^[\w.:-]{1,100}$/.test(code)).slice(0,4);
  if(status)return `O Mercado Livre recusou a operação (${status})${codes.length?': '+codes.join(', '):'. Confira a conexão e os dados do modelo.'}`;
  if(error instanceof BadRequestException)return error.message;
  return 'Não foi possível confirmar o resultado. Confira os anúncios criados antes de tentar novamente.';
}

export function copyAttributesMatch(actual:any[]=[],expected:any[]=[]){
  return expected.every(wanted=>{
    const found=actual.find(value=>wanted.id?value.id===wanted.id:value.name===wanted.name);
    if(!found)return false;
    const values=wanted.values??[{id:wanted.value_id,name:wanted.value_name}];
    const observed=found.values??[{id:found.value_id,name:found.value_name}];
    return values.every((value:any)=>observed.some((other:any)=>value.id!=null?String(value.id)===String(other.id)||value.name!=null&&value.name===other.name:String(value.name??'')===String(other.name??'')));
  });
}

export function duplicationWarnings(error:any):string[]|undefined {
  const response=error?.response,causes=response?.data?.cause;
  if(response?.status!==400||response.data?.error!=='validation_error'||!Array.isArray(causes)||!causes.length||causes.some((cause:any)=>cause.type!=='warning'))return undefined;
  const names:Record<string,string>={'shipping.lost_me1_by_user':'O vendedor não possui a modalidade de envio ME1.','item.shipping.mandatory_free_shipping':'O Mercado Livre exige frete grátis para esta publicação.'};
  return causes.map((cause:any)=>names[cause.code]||`Aviso do Mercado Livre: ${/^[\w.:-]{1,100}$/.test(cause.code??'')?cause.code:'confira as regras da categoria'}.`);
}
