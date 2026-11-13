import { titleKey } from './listing-duplication-model';

type Fact={name:string;value:string};
const STOP_WORDS=new Set(['a','as','o','os','um','uma','de','da','das','do','dos','e','em','no','na','nos','nas','para','por','com']);
const FORMS:Record<string,string>={masculino:'masculina',homem:'masculina',feminino:'feminina',mulher:'feminina',liso:'lisa',classico:'classica',importado:'importada',importacao:'importada',camisetas:'camiseta',camisas:'camisa',mangas:'manga',curtas:'curta',curtos:'curta',curto:'curta',longas:'longa',longos:'longa',longo:'longa',redondo:'redonda',tradicional:'classica'};
const PROMOTIONAL=new Set(['original','originais','autentica','autentico','autenticas','luxo','luxuoso','luxuosa','premium','top','melhor','melhores','exclusivo','exclusiva','perfeito','perfeita','imperdivel','oferta','ofertas','promocao','promocoes','desconto','frete','gratis','estoque','parcelamento']);
const PRODUCT_TYPES:Record<string,string[]>={camiseta:['camiseta','camisetas','t shirt','tshirt'],camisa:['camisa','camisas'],sueter:['sueter','sueteres','pulover'],bone:['bone','bones'],calca:['calca','calcas'],bermuda:['bermuda','bermudas'],jaqueta:['jaqueta','jaquetas'],casaco:['casaco','casacos'],cueca:['cueca','cuecas'],meia:['meia','meias'],vestido:['vestido','vestidos'],saia:['saia','saias'],blusa:['blusa','blusas'],tenis:['tenis'],bota:['bota','botas'],sapato:['sapato','sapatos'],mochila:['mochila','mochilas'],carteira:['carteira','carteiras']};
const BRAND_GROUPS=[['ralph lauren','polo ralph lauren','polo rl','rl'],['calvin klein','ck'],['tommy hilfiger','tommy','th'],['levi s','levis'],['hugo boss','hugo','boss'],['lacoste'],['nike'],['adidas'],['dudalina'],['ellus']];
const GENERIC_BRANDS=new Set(['generica','generico','sem marca','nao informado','n a']);

function matchingWords(tokens:string[],start:number,alias:string){
  const compact=titleKey(alias).replace(/\s/g,'');
  for(let length=1;length<=Math.min(6,tokens.length-start);length++)if(tokens.slice(start,start+length).join('')===compact)return length;
  return 0;
}
function containsAlias(title:string,alias:string){const tokens=titleKey(title).split(' ');return tokens.some((_token,index)=>matchingWords(tokens,index,alias)>0);}
export function listingTitleBrandAliases(original:string,facts:Fact[]=[]){
  const brands=facts.filter(fact=>['marca','brand'].includes(titleKey(fact.name))).map(fact=>fact.value).filter(value=>value.trim()&&!GENERIC_BRANDS.has(titleKey(value)));
  const aliases=new Set(brands.map(titleKey));
  for(const brand of brands){const parts=titleKey(brand).split(' ').filter(word=>word.length>1&&!['by','de','da','do'].includes(word));if(parts.length>1)aliases.add(parts.map(word=>word[0]).join(''));}
  for(const group of BRAND_GROUPS)if(group.some(alias=>brands.some(brand=>containsAlias(brand,alias))||containsAlias(original,alias)))for(const alias of group)aliases.add(alias);
  // "Polo" alone may be a garment type. Treat it as a brand alias only when
  // Ralph Lauren / RL was identified, never for an unrelated polo shirt.
  if(aliases.has('ralph lauren'))aliases.add('polo');
  return [...aliases].sort((a,b)=>b.length-a.length);
}
export function listingTitleBrandProblem(title:string,original:string,facts:Fact[]=[]){
  return listingTitleBrandAliases(original,facts).some(alias=>containsAlias(alias==='polo'?title.replace(/\bcamisa\s+polo\b/gi,'camisa'):title,alias))?'O título não pode incluir a marca nem suas abreviações. Remova a marca antes de continuar.':undefined;
}
export function cleanListingTitleSource(title:string,aliases:string[]){
  const tokens=titleKey(title).split(' '),kept:string[]=[];
  for(let index=0;index<tokens.length;){const found=aliases.filter(alias=>!(alias==='polo'&&tokens[index-1]==='camisa')).map(alias=>matchingWords(tokens,index,alias)).find(length=>length>0);if(found){index+=found;continue;}if(!PROMOTIONAL.has(tokens[index]))kept.push(tokens[index]);index++;}
  return kept.join(' ');
}
const words=(title:string)=>new Set(titleKey(title).replace(/\bsem estampa\b/g,'lisa').replace(/\b(?:estilo|modelo) (?:tradicional|classico|classica)\b/g,'classica').replace(/\bdesign (?:liso|lisa)\b/g,'lisa').replace(/\bt shirt\b/g,'camiseta').split(' ').filter(word=>word&&!STOP_WORDS.has(word)).map(word=>FORMS[word]??word));
function similarity(a:Set<string>,b:Set<string>){const union=new Set([...a,...b]);return union.size?[...a].filter(word=>b.has(word)).length/union.size:1;}
export function listingTitleSimilarity(left:string,right:string){return similarity(words(left),words(right));}
export function tooSimilarListingTitle(title:string,others:string[],facts:Fact[]=[]){
  const original=others[0]??'',aliases=listingTitleBrandAliases(original,facts),required=listingTitleRequirements(original,facts);
  const fixed=words([required.productType,...required.identifiers].filter(Boolean).join(' '));
  const candidate=words(cleanListingTitleSource(title,aliases));
  const variable=(tokens:Set<string>)=>new Set([...tokens].filter(word=>!fixed.has(word)));
  return others.some(other=>{const reference=words(cleanListingTitleSource(other,aliases));return similarity(candidate,reference)>=0.82||similarity(variable(candidate),variable(reference))>=0.8;});
}
export function listingTitleRequirements(original:string,facts:Fact[]=[]){
  const aliases=listingTitleBrandAliases(original,facts),cleaned=cleanListingTitleSource(original,aliases),source=cleaned.split(' ');
  const product=source.find(word=>Object.values(PRODUCT_TYPES).some(values=>values.includes(word)));
  const rewrites=[['masculina','para homem'],['masculino','para homem'],['feminina','para mulher'],['feminino','para mulher'],['lisa','sem estampa'],['liso','sem estampa'],['sem estampa','lisa'],['classica','estilo tradicional'],['classico','estilo tradicional']].filter(([word])=>cleaned.includes(word)).map(([from,to])=>({from,to}));
  const percentages=new Set((original.match(/\d+(?:[.,]\d+)?\s*%/g)??[]).flatMap(value=>titleKey(value).split(' ')));
  return {productType:product,forbiddenBrands:aliases,identifiers:source.filter(word=>/\d/.test(word)&&!percentages.has(word)),faithfulRewrites:rewrites};
}
export function listingTitleIdentityProblem(title:string,original:string,facts:Fact[]=[]){
  const brandProblem=listingTitleBrandProblem(title,original,facts);if(brandProblem)return brandProblem;
  const requirements=listingTitleRequirements(original,facts),candidate=' '+titleKey(title)+' ',product=requirements.productType;
  if(product){const aliases=Object.values(PRODUCT_TYPES).find(values=>values.includes(product))!;if(!aliases.some(alias=>candidate.includes(' '+alias+' ')))return `Preserve o tipo de produto do original: ${product}.`;}
  if(requirements.identifiers.some(code=>!candidate.includes(' '+code+' ')))return `Preserve os identificadores do modelo: ${requirements.identifiers.join(', ')}.`;
  return undefined;
}
export function listingTitleContentProblem(title:string,original:string,facts:Fact[]=[]){
  const promotional=titleKey(title).split(' ').find(word=>PROMOTIONAL.has(word));
  if(promotional)return `Não use termos promocionais ou de qualidade como "${promotional}". Prefira características técnicas.`;
  const aliases=listingTitleBrandAliases(original,facts),evidence=words(cleanListingTitleSource([original,...facts.filter(fact=>!['marca','brand'].includes(titleKey(fact.name))).map(fact=>fact.name+' '+fact.value)].join(' '),aliases));
  const requirements=listingTitleRequirements(original,facts);
  if(requirements.productType){for(const group of Object.values(PRODUCT_TYPES))if(group.includes(requirements.productType))for(const alias of group)for(const word of words(alias))evidence.add(word);}
  for(const word of words(title))if(!evidence.has(word)&&!(word.endsWith('s')&&evidence.has(word.slice(0,-1))))return `A característica "${word}" não consta nos dados do produto. Não invente estilo, material, caimento ou ocasião de uso.`;
  return undefined;
}
