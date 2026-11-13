export function sizeLabel(value: string): string {
  return (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase()
    .replace(/^\d+\s*\.\s*(PPP|PP|P|M|G|GG|XG|XXG|XGG|XXXG|XGGG|XXS|XS|S|L|XL|XXL|XXXL)$/, '$1');
}
export function equivalentSize(value: string): string {
  const aliases: Record<string,string> = {XXS:'PPP',XS:'PP',S:'P',L:'G',XL:'GG',XXL:'XXG',XGG:'XXG',XXXL:'XXXG',XGGG:'XXXG'};
  const keys=[...new Set(value.split('/').map(part=>sizeLabel(part).replace(/^(\d+(?:[.,]\d+)?)\s*BR$/, '$1')).filter(Boolean).map(part=>aliases[part]??part))];
  return keys.length===1?keys[0]:'';
}
export function compareSizes(first: string, second: string): number {
  const rank = (value: string): number => {
    const normalized = sizeLabel(value);
    const numeric = normalized.match(/^\d+(?:[.,]\d+)?(?:\s*(?:\/|-|A)\s*\d+(?:[.,]\d+)?)?$/);
    if (numeric) return 100 + Number.parseFloat(normalized.replace(',', '.'));
    const sizes: Record<string, number> = { PPP: -1, XXS: -1, PP: 0, XS: 0, P: 1, S: 1, M: 2, G: 3, L: 3, GG: 4, XL: 4, XG: 5, XXG: 5, XGG: 5, XXL: 5, '2XL': 5, XXXG: 6, XGGG: 6, XXXL: 6, '3XL': 6 };
    const parts = normalized.split('/').map(part => sizeLabel(part));
    for (const part of parts.reverse()) if (part in sizes) return sizes[part];
    return 10000;
  };
  return rank(first) - rank(second) || (first || '').localeCompare(second || '', 'pt-BR', { numeric: true });
}
