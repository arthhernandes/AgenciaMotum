import { normalizeNcmSearch } from './ncm-catalog';

/** Keyword retrieval only: no model calls and no automatic fiscal classification. */
export async function localNcmOptions(catalog:{ncmEntry:{findMany:(args:any)=>Promise<any[]>}},rows:any[],now=new Date()){
  const date=new Date(now.toISOString().slice(0,10));
  const entries=await catalog.ncmEntry.findMany({where:{level:8,AND:[{OR:[{validFrom:null},{validFrom:{lte:date}}]},{OR:[{validUntil:null},{validUntil:{gte:date}}]}]},orderBy:{code:'asc'}});
  const ignored=new Set(['original','originais','masculina','masculino','feminina','feminino','produto','marca','tamanho','modelo','premium','levis','ralph','lauren']);
  return rows.map(row=>{
    const name=normalizeNcmSearch(String(row.title??row.descricaoBling??''));
    const text=normalizeNcmSearch(name+' '+JSON.stringify(row.technical??row.dadosTecnicos??{}));
    const terms=[...new Set(text.split(/[^a-z0-9]+/).filter(term=>term.length>=4&&!ignored.has(term)).map(term=>term==='polo'||term.startsWith('camisa')&&!term.startsWith('camiseta')?'camis':term.startsWith('camiseta')?'camiset':term.startsWith('calca')?'calc':term))];
    const nature=(code:string)=>/\bcamiseta/.test(name)?code.startsWith('6109'):/\b(polo|camisa)\b/.test(name)?['6105','6106','6205','6206'].some(prefix=>code.startsWith(prefix)):true;
    const candidates=entries.filter(entry=>nature(entry.code)).map(entry=>({entry,matched:terms.filter(term=>normalizeNcmSearch(entry.searchText||entry.fullDescription||entry.description).includes(term))})).filter(value=>value.matched.length>0).sort((a,b)=>b.matched.length-a.matched.length||a.entry.code.localeCompare(b.entry.code));
    return {sku:row.sku,mlb:row.mlb,variationId:row.variationId,ncm:null,method:'catalog',options:candidates.slice(0,12).map(({entry,matched})=>({code:entry.code,formattedCode:entry.formattedCode,description:entry.fullDescription||entry.description,matchedTerms:matched})),notes:[candidates.length?'Opções encontradas por palavras-chave na tabela NCM importada. Escolha o código após conferir a descrição e as características do produto.':'Nenhuma opção encontrada por palavras-chave. Consulte a tabela NCM pelo nome técnico do produto.']};
  });
}
