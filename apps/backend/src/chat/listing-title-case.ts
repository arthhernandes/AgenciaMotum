/** The user's display convention applies to every word, including prepositions. */
export function listingTitleCase(value:string):string {
  return value.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR').replace(/\p{L}[\p{L}\p{M}\p{N}]*/gu,word=>word.charAt(0).toLocaleUpperCase('pt-BR')+word.slice(1));
}
