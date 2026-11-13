export const normalizeNcmSearch=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function ncmDate(value:string){
  if(!value)return null;
  const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);if(!match)throw new Error(`Data NCM inválida: ${value}`);
  const date=new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`);
  if(!Number.isFinite(date.getTime())||date.getUTCDate()!==Number(match[1])||date.getUTCMonth()+1!==Number(match[2]))throw new Error(`Data NCM inválida: ${value}`);
  return date;
}
export function prepareNcmEntries(input:any){
  if(!Array.isArray(input?.entries)||!input.entries.length||!/^\d{4}-\d{2}-\d{2}$/.test(input.referenceDate)||!input.source||!/^[a-f0-9]{64}$/i.test(input.sourceHash))throw new Error('Arquivo de importação NCM inválido.');
  const codes=new Set<string>();
  const referenceDate=new Date(input.referenceDate+'T00:00:00.000Z');
  if(!Number.isFinite(referenceDate.getTime())||referenceDate.toISOString().slice(0,10)!==input.referenceDate)throw new Error('Data de referência NCM inválida.');
  for(const row of input.entries){if(typeof row.code!=='string'||!/^\d{2,8}$/.test(row.code)||typeof row.formattedCode!=='string'||row.formattedCode.replace(/\./g,'')!==row.code||typeof row.description!=='string'||!row.description.trim()||codes.has(row.code))throw new Error('Código NCM inválido ou duplicado.');codes.add(row.code);}
  const entries=new Map<string,any>();
  for(const row of [...input.entries].sort((a,b)=>a.code.length-b.code.length||a.code.localeCompare(b.code))){
    let parentCode:string|null=null;for(let length=row.code.length-1;length>=2;length--){const prefix=row.code.slice(0,length);if(codes.has(prefix)){parentCode=prefix;break;}}
    const fullDescription=[parentCode?entries.get(parentCode).fullDescription:'',row.description].filter(Boolean).join(' > ');
    const validFrom=ncmDate(row.validFrom),validUntil=ncmDate(row.validUntil);if(validFrom&&validUntil&&validFrom>validUntil)throw new Error('Período NCM invertido.');
    const legalYear=row.legalYear?Number(row.legalYear):null;if(legalYear!==null&&!Number.isInteger(legalYear))throw new Error('Ano do ato legal inválido.');
    entries.set(row.code,{code:row.code,formattedCode:row.formattedCode,description:row.description,fullDescription,searchText:normalizeNcmSearch(`${row.code} ${row.formattedCode} ${fullDescription}`),level:row.code.length,parentCode,validFrom,validUntil,legalAct:row.legalAct||null,legalNumber:row.legalNumber||null,legalYear,source:input.source,sourceHash:input.sourceHash,referenceDate:new Date(input.referenceDate+'T00:00:00.000Z')});
  }
  return [...entries.values()];
}
