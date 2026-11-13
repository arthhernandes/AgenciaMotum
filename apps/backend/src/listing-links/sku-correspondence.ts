// Normalize only known spelling/gender equivalents. Shade qualifiers remain
// part of the key so navy, light blue and blue never become interchangeable.
export function colorKey(value:unknown):string {
  const aliases:Record<string,string>={preta:'preto',branca:'branco',amarela:'amarelo',vermelha:'vermelho',roxa:'roxo',dourada:'dourado',prateada:'prateado',clara:'claro',escura:'escuro'};
  return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).map(word=>aliases[word]??word).join(' ');
}
// Catalog order prefixes are labels, not numeric sizes (e.g. 2.P = P).
export function sizeLabel(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase()
    .replace(/^\d+\s*\.\s*(PPP|PP|P|M|G|GG|XG|XXG|XGG|XXXG|XGGG|XXS|XS|S|L|XL|XXL|XXXL)$/, '$1');
}
export function sizeKey(value: unknown): string {
  const aliases: Record<string, string> = { UN: 'UNICO', UNICO: 'UNICO', 'TAMANHO UNICO': 'UNICO', 'ONE SIZE': 'UNICO', XS: 'PP', S: 'P', M: 'M', L: 'G', XL: 'GG', XXL: 'XXG', XGG: 'XXG', XXXL: 'XXXG', XGGG: 'XXXG' };
  const parts = String(value ?? '').split('/').map(part => sizeLabel(part).replace(/^(\d+(?:[.,]\d+)?)\s*BR$/, '$1')).filter(Boolean);
  const keys = [...new Set(parts.map(part => aliases[part] ?? part))];
  return keys.length === 1 ? keys[0] : '';
}
export function sameSize(left: unknown, right: unknown): boolean {
  const key = sizeKey(left);
  return !!key && key === sizeKey(right);
}
export function correspondingVariant<T extends { sku: string; cor: string | null; tamanho: string | null }>(rows: T[], color: unknown, size: unknown): T | undefined {
  const c = colorKey(color), s = sizeKey(size);
  if (!c || !s) return undefined;
  const matches = rows.filter(row => colorKey(row.cor) === c && sizeKey(row.tamanho) === s);
  return matches.length === 1 ? matches[0] : undefined;
}
