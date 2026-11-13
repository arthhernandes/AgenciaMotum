/** Presentation and new API attributes use the same spelling without changing SKU identity. */
export function variantColorName(value:string):string {
  return value.trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR').split(' ').map((word,index)=>index>0&&['de','da','do','e'].includes(word)?word:word.charAt(0).toLocaleUpperCase('pt-BR')+word.slice(1)).join(' ');
}
