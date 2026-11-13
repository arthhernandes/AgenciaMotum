export type FiscalState={status:'complete'|'incomplete'|'unknown';reasons:string[]};
export function costCents(value:unknown):number|null{
  if(value===null||value===undefined||value===''||typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value))return null;
  const cost=Number(value),cents=Math.round((cost+Number.EPSILON)*100);return Number.isFinite(cost)&&cost>=0&&Number.isSafeInteger(cents)?cents:null;
}
export const costAboveBling=(fiscal:unknown,bling:unknown)=>{const a=costCents(fiscal),b=costCents(bling);return a!==null&&b!==null&&a>b;};
export function fiscalState(record:any,sku:string,sellerId:string):FiscalState{
  if(!sku)return {status:'incomplete',reasons:['SKU ausente']};
  if(!record)return {status:'incomplete',reasons:['Cadastro fiscal ausente']};
  if(record.sku!==sku||String(record.seller_id)!==sellerId)return {status:'unknown',reasons:['Cadastro fiscal de outro SKU ou vendedor']};
  const tax=record.tax_information??{},reasons:string[]=[];
  if(!/^\d{8}$/.test(String(tax.ncm??'')))reasons.push('NCM ausente ou inválido');
  if(!['manufacturer','importer','reseller'].includes(tax.origin_type))reasons.push('Tipo de origem ausente');
  if(!/^[0-8]$/.test(String(tax.origin_detail??'')))reasons.push('Código de origem ausente');
  if(!String(record.measurement_unit??'').trim())reasons.push('Unidade de medida ausente');
  if(record.cost===null||record.cost===undefined||record.cost===''||!Number.isFinite(Number(record.cost))||Number(record.cost)<0)reasons.push('Custo fiscal não informado');
  if(!/^(101|102|103|201|202|203|300|400|500|900)$/.test(String(tax.csosn??''))&&!(Number(tax.tax_rule_id)>0))reasons.push('Regime tributário não informado');
  if(/^300[1-6]/.test(String(tax.ncm??''))&&(!tax.med_anvisa_code||tax.med_anvisa_code==='ISENTO'&&!tax.med_exemption_reason))reasons.push('Dados obrigatórios de medicamento ausentes');
  return {status:reasons.length?'incomplete':'complete',reasons};
}
