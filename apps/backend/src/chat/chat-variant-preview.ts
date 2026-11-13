import type { MarketplacePlan, MarketplacePreview } from './chat-marketplace.service';
import type { CatalogRow } from './chat-catalog';
import { variantColorName } from './variant-color-name';

export function catalogPreviews(title:string,reference:string,rows:CatalogRow[],price?:number):MarketplacePreview[]{
  const groups=new Map<string,MarketplacePreview>();
  for(const row of rows){const color=row.cor??'Cor não informada';const key=color.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();let group=groups.get(key);
    if(!group){group={mlb:reference,title:`${title} · Cor ${variantColorName(color)}`,account:'Mercado Livre',fields:[],notes:['Consulta conferida com o catálogo. Este cartão não é uma proposta confirmável; nenhum envio é iniciado por ele.','Na prévia de publicação, o estoque será consultado ao vivo na Bling. Estoque zero permite oferta pausada.']};groups.set(key,group);}
    group.fields.push({field:`Tamanho ${row.tamanho??'não informado'}`,before:row.ofertaAtiva?'Oferta ativa':row.ofertaPublicada?'Oferta publicada, inativa':row.jaExisteNoPai?'Cadastrada, sem oferta':'Sem oferta',after:`SKU ${row.sku} · ${price==null?'preço a definir':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(price)} · estoque Bling salvo: ${row.quantidadePublicavel??'indisponível'}`});
  }
  const order=['P','M','G','GG','XXG'];return [...groups.values()].map(group=>({...group,fields:group.fields.sort((a,b)=>{const rank=(field:string)=>{const index=order.indexOf(field.replace('Tamanho ',''));return index<0?100:index;};return rank(a.field)-rank(b.field);})}));
}

/** A color is one review group; each size retains its own authoritative SKU. */
export function variantPreviews(plan:MarketplacePlan):MarketplacePreview[] {
  if(plan.kind==='update'&&plan.targets.some(target=>target.body.variations?.some((row:any)=>row.id==null))){
    const previews:MarketplacePreview[]=[];
    for(const target of plan.targets){const additions=target.body.variations?.filter((row:any)=>row.id==null)??[];
      if(!additions.length){previews.push(target.preview);continue;}
      const groups=new Map<string,MarketplacePreview>();
      for(const row of additions){const color=row.attribute_combinations?.find((a:any)=>a.id==='COLOR')?.value_name??'Cor não informada';const key=color.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();const size=row.attribute_combinations?.find((a:any)=>a.id==='SIZE')?.value_name??'não informado';let group=groups.get(key);if(!group){group={...target.preview,title:`${target.preview.title} · Cor ${variantColorName(color)}`,fields:[]};groups.set(key,group);}
        const sku=row.attributes?.find((a:any)=>a.id==='SELLER_SKU')?.value_name??'não informado';group.fields.push({field:`Tamanho ${size}`,before:'Não existe',after:`SKU ${sku} · ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(row.price)} · ${target.refreshBlingStockForAdditions?'estoque Bling na publicação':'estoque proposto: '+row.available_quantity}`});}
      previews.push(...[...groups.values()].map(group=>({...group,fields:[...group.fields,...target.preview.fields.filter(field=>field.field==='Tabela de medidas')]})));
    }return previews;
  }
  if (plan.kind !== 'family_variants' || plan.targets.some(target => !target.familyVariant)) return plan.targets.map(target => target.preview);
  const groups=new Map<string,MarketplacePreview>();
  for (const target of plan.targets) {
    const row=target.familyVariant!;
    const key=JSON.stringify([target.account.id,row.familyId,row.color.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()]);
    let group=groups.get(key);
    if (!group) {
      group={mlb:target.preview.mlb,title:`${target.preview.title} · Cor ${variantColorName(row.color)}`,account:target.preview.account,fields:[],notes:[...target.preview.notes,'Esta cor reúne os tamanhos abaixo. Cada tamanho mantém seu SKU e um registro próprio no Mercado Livre.']};
      groups.set(key,group);
    }
    group.fields.push({field:`Tamanho ${row.size}`,before:'Não existe',after:`SKU Bling ${row.sku}`});
    for (const field of target.preview.fields.filter(field => field.field === 'Fotos')) {
      if (!group.fields.some(existing => existing.field.startsWith('Fotos') && existing.after === field.after)) group.fields.push({...field,field:group.fields.some(existing => existing.field.startsWith('Fotos')) ? `Fotos · tamanho ${row.size}` : 'Fotos da cor'});
    }
    for (const note of target.preview.notes) if (!group.notes.includes(note)) group.notes.push(note);
  }
  return [...groups.values()].map(group => ({...group,fields:[...group.fields.filter(field => !field.field.startsWith('Fotos')),...group.fields.filter(field => field.field.startsWith('Fotos'))]}));
}

/** Upgrade older saved cards without altering their pending execution payload. */
export function groupSavedVariantPreviews(previews:MarketplacePreview[]) {
  const targets=[];
  for (const preview of previews) {
    const field=preview.fields.find(field => field.field === 'Nova variante na família');
    const parts=field?.after.match(/^(.+)\s+(\S+)\s+—\s+SKU Bling\s+(\S+)$/);
    if (!preview.mlb.startsWith('Família ') || !parts) return previews;
    targets.push({account:{id:preview.account},familyVariant:{familyId:preview.mlb,color:parts[1],size:parts[2],sku:parts[3]},preview});
  }
  return targets.length ? variantPreviews({kind:'family_variants',targets:targets as MarketplacePlan['targets']}) : previews;
}



