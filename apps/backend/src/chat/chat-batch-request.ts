import {BatchSpec,BatchStage} from './chat-batch.service';
export function batchRequest(text:string,scope?:{mode:string;reference:string},question=false):BatchSpec|null{
 if(question)return null;const normalized=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/\b(nao|nunca)\b.{0,30}(adicion|alter|revis|public|use|usar|apli|inclu)/.test(normalized))return null;
 const stages:BatchStage[]=[];
 if(/adicion|inclu|complet|acrescent|publique|publicar/.test(normalized)&&/variac|cores|tamanhos/.test(normalized))stages.push('variations');
 if(/fisc|\bncm\b/.test(normalized)&&/revis|arrum|corrig|sug|confir|verifi|ajust|analis/.test(normalized))stages.push('fiscal');
 if(/preco|valor/.test(normalized)&&/alter|mud|ajust|atualiz|use|usar|apli|coloque|defin|troqu/.test(normalized))stages.push('price');
 const codes=[...new Set(text.toUpperCase().match(/\bMLB\d+\b/g)??[])];
 const references=codes.length?codes:scope?.mode==='multiple'?scope.reference.split(/[;,\n]/).map(value=>value.trim()).filter(Boolean):stages.length>1&&scope?.mode==='listing'?[scope.reference]:codes;
 if(!stages.length||!references.length||references.length===1&&stages.length===1)return null;
 const spec:BatchSpec={references,stages};
 if(stages.includes('price')){
  if(/(?:precos?|valores?).{0,40}bling|bling.{0,30}(?:precos?|valores?)/.test(normalized))spec.priceSource='bling';
  else{
   const matches=[...normalized.matchAll(/(?:para|r\$|preco(?:\s+de)?|valor(?:\s+de)?)\s*(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)\b/g)];
   if(matches.length===1){spec.price=Number(matches[0][1].replace(',','.'));spec.priceSource='fixed';}
   const prices:Record<string,number>={};
   for(const line of text.split(/[;\n]/)){const value=line.match(/(?:para|R\$|preço\s*(?:de|:)?|valor\s*(?:de|:)?)\s*(?:R\$\s*)?(\d+(?:[.,]\d{1,2})?)\b/i)?.[1];if(value)for(const reference of references)if(line.toLowerCase().includes(reference.toLowerCase()))prices[reference]=Number(value.replace(',','.'));}
   if(Object.keys(prices).length){spec.prices=prices;spec.price=undefined;spec.priceSource='fixed';}
  }
 }
 return spec;
}
