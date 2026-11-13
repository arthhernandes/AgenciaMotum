export function catalogSearch(value:string){
 const text=value.trim();
 const sku=/^sku\s*[:#-]?\s*(.+)$/i.exec(text);
 const mlb=/^(?:mlb\s*[:#]?\s*)?(MLB\d+)$/i.exec(text);
 if(sku)return {kind:'sku' as const,term:sku[1].trim()};
 if(mlb)return {kind:'mlb' as const,term:mlb[1].toUpperCase()};
 if(/^\d+(?:\.\d+)?$/.test(text))return {kind:'sku' as const,term:text};
 return {kind:'text' as const,term:text};
}
export function matchesCatalogSku(value:unknown,term:string){const sku=String(value??'').toLowerCase();const query=term.toLowerCase();return sku===query||!query.includes('.')&&sku.startsWith(query+'.');}
