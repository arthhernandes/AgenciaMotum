import { listingWriteBlock } from '../listings/listing-write-block';
import { marketplaceSyncEvents } from '../mercadolivre/sync-events';
import { BadRequestException, Injectable } from '@nestjs/common';
import { MercadoLivreClient } from '../mercadolivre/mercadolivre.client';
import { BlingSyncService } from '../bling/synchronization/bling-sync.service';
import { ChatMarketplaceService } from './chat-marketplace.service';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';

export const FISCAL_FIELDS=['ncm','cest','origin_type','origin_detail','ean','measurement_unit','cost','csosn','tax_rule_id','fci','ex_tipi','med_anvisa_code','med_exemption_reason','net_weight','gross_weight'] as const;
export function fiscalUnit(value:unknown){const unit=String(value??'').trim();return /^(un|unid|unidade|unidades)\.?$/i.test(unit)?'UNID':unit;}
function fiscalBlingValue(field:string,value:unknown){return field==='measurement_unit'?fiscalUnit(value):field==='ncm'?String(value??'').replace(/[.\s-]/g,''):value;}
export const FISCAL_LABELS:Record<string,string>={ncm:'NCM',cest:'CEST',origin_type:'Tipo de origem',origin_detail:'Código de origem',ean:'GTIN / EAN',measurement_unit:'Unidade de medida',cost:'Custo de aquisição (R$)',csosn:'CSOSN',tax_rule_id:'ID da regra tributária',fci:'FCI',ex_tipi:'Exceção TIPI',med_anvisa_code:'Código Anvisa',med_exemption_reason:'Motivo da isenção Anvisa',net_weight:'Peso líquido (kg)',gross_weight:'Peso bruto (kg)'};
export type FiscalRow={planned?:boolean;mlb:string;variationId?:string;sku:string;title:string;color?:string;size?:string;current:any;itemFiscal?:any;taxRule?:any;technical?:any;family?:string;blingValues?:Record<string,string>;values:Record<string,string>;sources:Record<string,string>;warnings:string[]};
export function orderedFiscalRows(rows:FiscalRow[]){
 const size=(row:FiscalRow)=>row.size?.trim().toUpperCase()??/\b(XXG|GG|P|M|G)\s*$/i.exec(row.title)?.[1].toUpperCase()??'';
 const rank=(row:FiscalRow)=>{const index=['P','M','G','GG','XXG'].indexOf(size(row));return index<0?100:index;};
 return [...rows].sort((a,b)=>(a.color??'').localeCompare(b.color??'','pt-BR',{sensitivity:'base'})||rank(a)-rank(b));
}
export function fiscalItemRecord(detail:any,sku:string,variationId?:string):any{
 const entries:any[]=Array.isArray(detail)?detail:Array.isArray(detail?.variations)?detail.variations:[detail];
 const collection=Array.isArray(detail)||Array.isArray(detail?.variations);
 const matches=entries.filter(entry=>entry&&(!variationId||!collection&&entry.variation_id==null||String(entry.variation_id??entry.id)===variationId)).map(entry=>typeof entry.sku==='object'?entry.sku:entry).filter(record=>record?.sku===sku&&record.tax_information&&typeof record.tax_information==='object');
 return matches.length===1?matches[0]:null;
}
export type FiscalPlan={reference:string;rows:FiscalRow[];approved:boolean;regime:string;requiredOnly?:boolean;regimeLocked?:boolean;regimeConflict?:boolean};
export function existingFiscalRegime(current:any){return current?.tax_information?.tax_rule_id?'normal':current?.tax_information?.csosn?'simples':'';}
export function requiredFiscalFields(values:Record<string,string>,regime:string){
 const fields=['ncm','origin_type','origin_detail',...(regime==='simples'?['csosn']:regime==='normal'?['tax_rule_id']:[])];
 if(/^300[1-6]/.test(String(values.ncm??'').replace(/[.\s-]/g,''))){fields.push('med_anvisa_code');if(values.med_anvisa_code==='ISENTO')fields.push('med_exemption_reason');}
 return fields;
}
export function fiscalFailure(error:any,stage:string){
 const status=error?.response?.status,body=error?.response?.data;
 if(status===400){
  const fields=Array.isArray(body?.fields)?body.fields:Array.isArray(body?.cause)?body.cause:[];
  const details=fields.map((entry:any)=>{const field=String(entry.field??entry.path??'').replace(/^tax_information\./,''),label=FISCAL_LABELS[field];if(!label)return null;const text=String(entry.message??'');return label+': '+(/required|mandatory|obrigat/i.test(text)?'campo obrigatório':/numeric|number/i.test(text)?'informe um número válido':'valor recusado pelo Mercado Livre');}).filter(Boolean);
  return `Mercado Livre recusou os dados (HTTP 400). ${details.length?[...new Set(details)].join('; ')+'.':'Confira o regime tributário e os valores da revisão.'}`;
 }
 if(status===401||status===403)return `Mercado Livre recusou a autorização fiscal (HTTP ${status}). Confira a conexão e as permissões da conta.`;
 if(error?.message==='readback')return 'O envio terminou, mas a leitura de confirmação retornou valores diferentes. Consulte o cadastro antes de reenviar.';
 return `Não foi possível confirmar ${stage}${Number.isInteger(status)?' (HTTP '+status+')':''}. Consulte o cadastro antes de reenviar.`;
}
const project=(value:any)=>{const tax=value?.tax_information??{};return Object.fromEntries(FISCAL_FIELDS.map(key=>{const raw=(key==='cost'||key==='measurement_unit'?value?.[key]:tax[key]);return [key,raw==null?'':key==='measurement_unit'?fiscalUnit(raw):key==='cost'||key==='net_weight'||key==='gross_weight'?String(Number(raw)):key==='med_anvisa_code'&&/^\d{1,13}$/.test(String(raw))?String(raw).padStart(13,'0'):String(raw)];}));};
export function fiscalValuesMatch(payload:any,current:any){
 const expected=project(payload),actual=project(current);
 return !!current&&FISCAL_FIELDS.every(field=>
  (field==='measurement_unit'||field==='cost')&&!Object.prototype.hasOwnProperty.call(payload,field)||expected[field]===actual[field]);
}
export function fiscalPayload(row:FiscalRow,regime:string){
 const v:Record<string,string>={...row.values,ncm:row.values.ncm?.replace(/[.\s-]/g,'')??'',cest:row.values.cest?.replace(/[.\s-]/g,'')??'',measurement_unit:fiscalUnit(row.values.measurement_unit)};
 if(Object.keys(v).some(key=>!FISCAL_FIELDS.includes(key as any))||Object.values(v).some(value=>typeof value!=='string'||value.length>255))throw new BadRequestException('Campos fiscais inválidos.');
 if(!/^\d{8}$/.test(v.ncm)||!['manufacturer','reseller','imported'].includes(v.origin_type)||!/^\d$/.test(v.origin_detail))throw new BadRequestException(`SKU ${row.sku}: revise NCM e origem.`);
 if(v.cest&&!/^\d{7}$/.test(v.cest)||v.ean&&!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(v.ean))throw new BadRequestException(`SKU ${row.sku}: CEST ou GTIN inválido.`);
 if(!['simples','normal'].includes(regime)||regime==='simples'&&!/^(101|102|103|201|202|203|300|400|500|900)$/.test(v.csosn)||regime==='normal'&&!/^[1-9]\d*$/.test(v.tax_rule_id))throw new BadRequestException(`SKU ${row.sku}: informe o regime e CSOSN ou regra tributária.`);
 if(v.fci&&(!['3','5','8'].includes(v.origin_detail)||!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v.fci)))throw new BadRequestException('Revise a FCI e sua origem.');
 if(v.cost&&(!Number.isFinite(Number(v.cost))||Number(v.cost)<0))throw new BadRequestException('Custo inválido.');
 for(const key of ['net_weight','gross_weight'])if(v[key]&&!/^\d{1,13}(?:\.\d{1,3})?$/.test(v[key]))throw new BadRequestException('Peso inválido; informe quilogramas com até três casas decimais.');
 if(v.net_weight&&v.gross_weight&&Number(v.gross_weight)<Number(v.net_weight))throw new BadRequestException('O peso bruto não pode ser menor que o peso líquido.');
 if(/^300[1-6]/.test(v.ncm)&&!v.med_anvisa_code)throw new BadRequestException('Código Anvisa obrigatório para este NCM de medicamento.');
 if(v.med_anvisa_code){if(!/^(ISENTO|\d{1,13})$/.test(v.med_anvisa_code)||!/^300[1-6]/.test(v.ncm))throw new BadRequestException('Revise o código Anvisa e o NCM de medicamento.');if(v.med_anvisa_code==='ISENTO'&&!v.med_exemption_reason||v.med_anvisa_code!=='ISENTO'&&v.med_exemption_reason)throw new BadRequestException('Revise o motivo de isenção Anvisa.');}
 else if(v.med_exemption_reason)throw new BadRequestException('Motivo de isenção exige código Anvisa ISENTO.');
 const tax={...(row.current?.tax_information??{})};delete tax.empty;
 for(const key of FISCAL_FIELDS){if(key==='cost'||key==='measurement_unit'||!(key in v))continue;if(v[key])tax[key]=['tax_rule_id','net_weight','gross_weight'].includes(key)?Number(v[key]):key==='med_anvisa_code'&&/^\d{1,13}$/.test(v[key])?v[key].padStart(13,'0'):v[key];else delete tax[key];}
 delete tax[regime==='simples'?'tax_rule_id':'csosn'];
 return {sku:row.sku,title:row.title,type:'single',...(v.measurement_unit?{measurement_unit:v.measurement_unit}:{}),...(v.cost?{cost:Number(v.cost)}:{}),tax_information:tax};
}
@Injectable()
export class ChatFiscalService {
 private readonly locks=new Set<string>();
 async taxRules(account:{id:string;businessKey:string;sellerId:string},reference:string){
  const targets=await this.marketplace.fiscalSources(account,reference,true);
  const sellers=[...new Map(targets.map(target=>[target.account.sellerId,target])).values()];
  if(sellers.length!==1)throw new BadRequestException('Consulte as regras de um vendedor por vez.');
  const target=sellers[0],rules=new Map<number,{id:number;description:string}>();let offset=0;
  for(;;){
   const page=await this.readFiscal(target,token=>this.client.getFiscalTaxRules(token,target.account.sellerId,offset));
   if(!Array.isArray(page?.results)||!Number.isSafeInteger(page?.paging?.total))throw new BadRequestException('Resposta inválida ao consultar as regras tributárias.');
   for(const rule of page.results){
    if(String(rule.user_id)!==String(target.account.sellerId)||!Number.isSafeInteger(rule.id)||rule.id<=0)throw new BadRequestException('Não foi possível confirmar o vendedor da regra tributária.');
    rules.set(rule.id,{id:rule.id,description:String(rule.description??'Regra sem descrição')});
   }
   offset+=page.results.length;
   if(offset>=page.paging.total)break;
   if(!page.results.length||offset>10000)throw new BadRequestException('A consulta das regras tributárias ficou incompleta.');
  }
  return [...rules.values()];
 }
 constructor(private readonly client:MercadoLivreClient,private readonly bling:BlingSyncService,private readonly marketplace:ChatMarketplaceService){}
 private async readFiscal<T>(target:{token:string;account:{id:string}},read:(token:string)=>Promise<T>):Promise<T>{
  try{return await read(target.token);}catch(error){
   if((error as any)?.response?.status!==401)throw error;
   try{target.token=await this.marketplace.refreshFiscalToken(target.account.id);return await read(target.token);}
   catch(retryError){const status=(retryError as any)?.response?.status;
    if(status===403)throw new BadRequestException('O Mercado Livre recusou a permissão para consultar os dados fiscais. Confira as permissões da integração.');
    if(status&&status!==401&&status!==400)throw retryError;
    throw new BadRequestException('A autenticação da conta Mercado Livre foi recusada, mesmo após tentar renovar a credencial. Reconecte a conta Mercado Livre nas integrações e consulte novamente.');
   }
  }
 }
 async prepare(account:{id:string;businessKey:string;sellerId:string},reference:string,suggest:(rows:any[])=>Promise<any[]>,additionalSkus:string[]=[]):Promise<FiscalPlan>{
  const targets=(await this.marketplace.fiscalSources(account,reference,true)).filter(target=>!listingWriteBlock(target.item));const rows:FiscalRow[]=[];
  for(const target of targets){await this.marketplace.assertSourceWritable(target);let itemFiscal:any;let itemWarning='';
   try{itemFiscal=await this.readFiscal(target,token=>this.client.getFiscalByItem(token,target.item.id));}catch(error){if(error instanceof BadRequestException||[401,403].includes((error as any)?.response?.status))throw error;itemWarning='Não foi possível consultar os dados fiscais por item. A consulta por SKU será tentada separadamente.';}
   const variants=target.item.variations?.length?target.item.variations:[target.item];for(const variant of variants){
   const sku=sellerSku(variant);if(!sku)throw new BadRequestException('Corrija os SKUs ausentes antes de preparar os dados fiscais.');
   const byItem=fiscalItemRecord(itemFiscal,sku,variant===target.item?undefined:String(variant.id));
   const current=byItem??await this.readFiscal(target,token=>this.client.getFiscalBySku(token,sku));
   if(current&&String(current.seller_id)!==target.account.sellerId)throw new BadRequestException('Cadastro fiscal de outro vendedor.');
   if(current?.type==='bundle')throw new BadRequestException('Kits precisam de composição fiscal própria.');
   const row:FiscalRow={mlb:target.item.id,variationId:variant===target.item?undefined:String(variant.id),sku,title:target.item.title??sku,current,values:project(current),sources:{},warnings:[]};
   const attributes=[...((variant as any).attribute_combinations??[]),...(variant.attributes??[])] as Array<{id:string;value_name?:string}>;
   row.color=attributes.find(value=>value.id==='COLOR')?.value_name;row.size=attributes.find(value=>value.id==='SIZE')?.value_name;
   row.itemFiscal=itemFiscal??null;
   row.warnings.push('SKUs e dados fiscais consultados ao vivo; antes de enviar alterações, o anúncio será conferido novamente.');
   if(itemWarning)row.warnings.push(itemWarning);
   if(!current)row.warnings.push('O Mercado Livre não possui cadastro fiscal para este SKU. Os valores propostos ainda não foram enviados.');
   for(const key of FISCAL_FIELDS)if(row.values[key])row.sources[key]='Mercado Livre';
   if(row.values.tax_rule_id){try{const rule=await this.client.getFiscalTaxRule(target.token,target.account.sellerId,Number(row.values.tax_rule_id));if(String(rule.user_id)!==target.account.sellerId)throw new Error('owner');row.taxRule={id:rule.id,description:rule.description,transactions:rule.transactions};}catch{row.warnings.push('Não foi possível consultar a regra tributária atual; CFOP e CST não foram confirmados.');}}
   else row.warnings.push('CFOP e CST dependem da operação e das regras tributárias do vendedor. Não serão deduzidos pelo nome do produto.');
   try{const product=await this.bling.fiscalProductForSku(account.id,sku);row.blingValues={};row.title=product.name||row.title;row.technical=product.technical;row.family=product.family;row.size=product.size??row.size;row.color=product.color??row.color;if(product.name)row.sources.title='Bling';for(const [key,rawValue] of Object.entries(product.fields)){const value=fiscalBlingValue(key,rawValue);if(value!==null&&value!==undefined&&String(value)!==''){if(row.values[key]&&row.values[key]!==String(value))row.warnings.push(`${key}: cadastro Bling diverge do Mercado Livre.`);row.blingValues[key]=String(value);row.values[key]=String(value);row.sources[key]='Bling';}}if(product.shared)row.warnings.push('Cadastro de produto compartilhado: dados tributários do vendedor precisam ser revisados.');}
   catch(error){
    const message=error instanceof BadRequestException?error.message:'';
    row.warnings.push(message||'Não foi possível consultar os dados fiscais da Bling para este SKU.');
    if(!Object.values(row.values).some(Boolean)){
     if(/cadastro Bling|SKU retornado|não corresponde/i.test(message))throw new BadRequestException(`${row.mlb}: o Mercado Livre não retornou cadastro fiscal para o SKU ${row.sku}, e não foi possível vinculá-lo a um produto na Bling. Deseja revisar e corrigir os SKUs que podem estar incorretos?`);
     throw new BadRequestException(`${row.mlb}: o Mercado Livre não retornou cadastro fiscal para o SKU ${row.sku} e a consulta à Bling falhou. Confira a conexão da Bling e consulte novamente; não foi criada uma revisão vazia.`);
    }
   }
   rows.push(row);
  }}
  const model=targets[0];
  for(const sku of [...new Set(additionalSkus)].filter(sku=>!rows.some(row=>row.sku===sku))){
   if(!model)throw new BadRequestException('Anúncio modelo não identificado para a revisão fiscal.');
   const product=await this.bling.fiscalProductForSku(account.id,sku);const current=await this.readFiscal(model,token=>this.client.getFiscalBySku(token,sku));
   if(current&&String(current.seller_id)!==model.account.sellerId)throw new BadRequestException('Cadastro fiscal de outro vendedor.');
   if(current?.type==='bundle')throw new BadRequestException('Kits precisam de revisão fiscal própria.');
   const row:FiscalRow={planned:true,mlb:model.item.id,sku,title:product.name||sku,color:product.color??undefined,size:product.size??undefined,technical:product.technical,family:product.family,current,blingValues:{},values:project(current),sources:{title:'Bling'},warnings:['Variação a publicar: o vínculo fiscal será feito somente após conferir sua criação pelo SKU.']};
   for(const field of FISCAL_FIELDS)if(row.values[field])row.sources[field]='Mercado Livre';
   for(const [field,value] of Object.entries(product.fields))if(value!=null&&String(value)!==''){row.values[field]=String(fiscalBlingValue(field,value));row.blingValues![field]=row.values[field];row.sources[field]='Bling';}
   const siblings=rows.filter(value=>value.family&&value.family===row.family&&!value.planned);
   for(const field of ['origin_type','csosn','tax_rule_id']){const values=[...new Set(siblings.map(value=>value.values[field]).filter(Boolean))];if(!row.values[field]&&siblings.length&&values.length===1&&siblings.every(value=>value.values[field]===values[0])){row.values[field]=values[0];row.sources[field]='Sugestão da família · revisar';}}
   rows.push(row);
  }
  const candidates=rows.filter(row=>row.sources.title==='Bling');if(candidates.length){try{const suggestions=await suggest(candidates.map(row=>({sku:row.sku,descricaoBling:row.title,dadosTecnicos:row.technical,...(row.family?{familia:row.family}:{}),...(row.size?{tamanho:row.size}:{}),...(row.values.ncm?{ncmAtual:row.values.ncm}:{})})));for(const row of candidates){const suggestion=suggestions.find(value=>value.sku===row.sku);if(Array.isArray(suggestion?.notes))row.warnings.push(...suggestion.notes.filter((note:any)=>typeof note==='string'));if(typeof suggestion?.ncm==='string'&&/^\d{8}$/.test(suggestion.ncm)){row.values.ncm=suggestion.ncm;row.sources.ncm=suggestion.method==='catalog'?'Sugestão aproximada · base NCM':suggestion.approximate?'Sugestão aproximada da IA':'Sugestão da IA';row.warnings.push('NCM sugerido pela descrição: confirme a classificação fiscal do produto.');}}}catch{for(const row of candidates)row.warnings.push('Não foi possível avaliar o NCM pela descrição; revise a classificação.');}}
  const empty=rows.filter(row=>!Object.values(row.values).some(Boolean));
  if(!rows.length||empty.length)throw new BadRequestException(`Não foi possível obter dados fiscais para ${empty.map(row=>`${row.mlb} · SKU ${row.sku}`).join(', ')||reference}. Confira o cadastro do produto na Bling antes de preparar a revisão.`);
  // Bling suggestions must not replace the tax configuration already used by this SKU.
  for(const row of rows)if(existingFiscalRegime(row.current)){
   for(const field of ['csosn','tax_rule_id']){
    row.values[field]=project(row.current)[field];
    if(row.values[field])row.sources[field]='Mercado Livre';else delete row.sources[field];
   }
  }
  const regimes=new Set(rows.map(row=>existingFiscalRegime(row.current)).filter(Boolean));
  return {reference,rows:orderedFiscalRows(rows),approved:false,regime:regimes.size===1?[...regimes][0]:'',regimeLocked:regimes.size===1,regimeConflict:regimes.size>1};
 }
 approve(plan:FiscalPlan,body:any):FiscalPlan{
  const regimes=new Set(plan.rows.map(row=>existingFiscalRegime(row.current)).filter(Boolean));
  if(regimes.size>1)throw new BadRequestException('Os SKUs possuem regimes fiscais diferentes. Revise os produtos separadamente.');
  const fixedRegime=[...regimes][0]||plan.regime;
  if(fixedRegime&&body?.regime!==fixedRegime)throw new BadRequestException('O regime tributário deve permanecer igual ao cadastro fiscal atual do produto.');
  if(!Array.isArray(body?.rows)||body.rows.length!==plan.rows.length)throw new BadRequestException('Revise todos os SKUs.');
  const rows=plan.rows.map(row=>{const matches=body.rows.filter((edit:any)=>edit.sku===row.sku&&edit.mlb===row.mlb&&edit.variationId===row.variationId);if(matches.length!==1)throw new BadRequestException('Confirme cada SKU uma unica vez.');const edit=matches[0];if(edit.sku!==row.sku||edit.mlb!==row.mlb||edit.variationId!==row.variationId)throw new BadRequestException('A identificação da variação não pode ser alterada.');const fields=[...requiredFiscalFields(edit.values??{},body.regime),...['cost','net_weight','gross_weight'].filter(field=>Object.prototype.hasOwnProperty.call(edit.values??{},field))];const values=body.requiredOnly?{...project(row.current),...Object.fromEntries(fields.map(field=>[field,String(edit.values?.[field]??'')]))}:{...edit.values,measurement_unit:fiscalUnit(edit.values?.measurement_unit)};const next={...row,values,sources:{...row.sources}};for(const key of FISCAL_FIELDS)if(row.values[key]!==edit.values?.[key])next.sources[key]='Revisado pelo usuário';fiscalPayload(next,body.regime);return next;});
  return {...plan,rows:orderedFiscalRows(rows),regime:body.regime,requiredOnly:body.requiredOnly===true,approved:true};
 }
 preview(plan:FiscalPlan){return orderedFiscalRows(plan.rows).map(row=>({mlb:row.mlb,title:`${row.title} · SKU ${row.sku}`,account:'Mercado Livre',fields:FISCAL_FIELDS.filter(field=>!plan.requiredOnly||['cost','net_weight','gross_weight'].includes(field)||requiredFiscalFields(row.values,plan.regime).includes(field)).map(field=>({field:FISCAL_LABELS[field],before:project(row.current)[field]||'Não informado',bling:row.blingValues?String(fiscalBlingValue(field,row.blingValues[field])??'')||'Não informado':'Indisponível nesta prévia',after:`${row.values[field]||'A preencher na revisão'}${row.sources[field]?' · '+row.sources[field]:''}`})),notes:row.warnings.concat('Campos não informados pela API aparecem como ausentes; isso não significa que a classificação foi validada. Dados por SKU podem afetar anúncios que compartilham o mesmo cadastro fiscal.')}));}
 async execute(plan:FiscalPlan,account:{id:string;businessKey:string;sellerId:string},userId:string){
  const keys=[...new Set(plan.rows.map(row=>account.businessKey+':'+row.sku))];
  if(keys.some(key=>this.locks.has(key)))throw new BadRequestException('Aguarde a outra revisao fiscal em andamento.');
  keys.forEach(key=>this.locks.add(key));
  try{return await this.executeLocked(plan,account,userId);}finally{keys.forEach(key=>this.locks.delete(key));}
 }
 async verify(plan:FiscalPlan,account:{id:string;businessKey:string;sellerId:string}){
  const targets=await this.marketplace.fiscalSources(account,plan.reference);
  for(const row of plan.rows){const matches=targets.flatMap(target=>(target.item.variations?.length?target.item.variations:[target.item]).filter(value=>sellerSku(value)===row.sku).map(value=>({target,value})));if(matches.length!==1)return false;const {target,value}=matches[0];const current=await this.client.getFiscalBySku(target.token,row.sku);const expected=project(fiscalPayload(row,plan.regime));if(!current||String(current.seller_id)!==target.account.sellerId||!fiscalValuesMatch(fiscalPayload(row,plan.regime),current))return false;const itemFiscal=await this.client.getFiscalByItem(target.token,target.item.id);const variationId=value===target.item?undefined:String(value.id);if(!fiscalItemRecord(itemFiscal,row.sku,variationId))return false;const invoice=await this.client.canInvoice(target.token,target.item.id,variationId);if(invoice?.status!==true)return false;}
  return plan.rows.length>0;
 }
 private async fiscalLinkConfirmed(target:any,row:FiscalRow){
  try{
   const detail=await this.readFiscal(target,token=>this.client.getFiscalByItem(token,row.mlb));
   if(row.variationId&&!Array.isArray(detail)&&!Array.isArray(detail?.variations)&&String(detail?.variation_id??'')!==row.variationId)return false;
   const record=fiscalItemRecord(detail,row.sku,row.variationId);
   return !!record&&String(record.seller_id)===target.account.sellerId&&(!detail?.item_id||detail.item_id===row.mlb)&&(!detail?.seller_id||String(detail.seller_id)===target.account.sellerId);
  }catch{return false;}
 }
 private async executeLocked(plan:FiscalPlan,account:{id:string;businessKey:string;sellerId:string},userId:string){
  await this.marketplace.authorizeFiscal(userId);
  if(!plan.approved)throw new BadRequestException('Revise os campos fiscais antes de confirmar.');
  const targets=(await this.marketplace.fiscalSources(account,plan.reference)).filter(target=>!listingWriteBlock(target.item));const prepared=[];
  for(const target of targets)await this.marketplace.assertSourceWritable(target);
  for(const approved of plan.rows){let row=approved;if(row.planned){const matches=targets.flatMap(target=>(target.item.variations?.length?target.item.variations:[target.item]).filter(value=>sellerSku(value)===row.sku).map(value=>({target,value})));if(matches.length!==1)throw new BadRequestException('A nova variacao ainda nao foi publicada ou seu SKU nao e unico.');const match=matches[0];row={...row,mlb:match.target.item.id,variationId:match.value===match.target.item?undefined:String(match.value.id)};}const target=targets.find(target=>target.item.id===row.mlb);const variant=row.variationId?target?.item.variations?.find(value=>String(value.id)===row.variationId):target?.item;if(!target||sellerSku(variant)!==row.sku)throw new BadRequestException('O SKU ou anúncio mudou. Prepare uma nova revisão fiscal.');const current=await this.client.getFiscalBySku(target.token,row.sku);if(JSON.stringify(project(current))!==JSON.stringify(project(row.current)))throw new BadRequestException('Dados fiscais mudaram desde a revisão. Prepare uma nova prévia.');const fixedRegime=existingFiscalRegime(current);if(fixedRegime&&fixedRegime!==plan.regime)throw new BadRequestException('O regime tributário do produto não pode ser alterado nesta revisão.');const payload=fiscalPayload(row,plan.regime);if(plan.regime==='normal'){const rule=await this.client.getFiscalTaxRule(target.token,target.account.sellerId,Number(row.values.tax_rule_id));if(String(rule.user_id)!==target.account.sellerId)throw new BadRequestException('Regra tributária de outro vendedor.');}prepared.push({row,target,payload});}
  const duplicates=new Map<string,string>();for(const entry of prepared){const key=entry.target.account.id+':'+entry.row.sku;const serialized=JSON.stringify(entry.payload);if(duplicates.has(key)&&duplicates.get(key)!==serialized)throw new BadRequestException('Mesmo SKU com propostas fiscais diferentes.');duplicates.set(key,serialized);}
  const saved=new Set<string>();const results=[];
  for(const {row,target,payload} of prepared){let stage='cadastro';try{const key=target.account.id+':'+row.sku;if(!saved.has(key)){if(row.current)await this.client.updateFiscal(target.token,row.sku,payload);else await this.client.createFiscal(target.token,payload);stage='conferência do cadastro';const verified=await this.readFiscal(target,token=>this.client.getFiscalBySku(token,row.sku));const expected=project(payload);if(!verified||String(verified.seller_id)!==target.account.sellerId||!fiscalValuesMatch(payload,verified))throw new Error('readback');saved.add(key);marketplaceSyncEvents.emit('fiscal-updated',{accountId:target.account.id,sku:row.sku,cost:verified.cost});}stage='vínculo';if(!await this.fiscalLinkConfirmed(target,row)){let binding:any,bindingError:any;try{binding=await this.client.bindFiscal(target.token,row.sku,row.mlb,row.variationId);}catch(error){bindingError=error;}const acknowledged=binding?.sku===row.sku&&binding?.item_id===row.mlb&&String(binding?.variation_id??'')===(row.variationId??'')&&binding?.status==='active';if(!acknowledged&&!await this.fiscalLinkConfirmed(target,row))throw bindingError??new Error('binding');}stage='habilitação da emissão fiscal';const invoice=await this.client.canInvoice(target.token,row.mlb,row.variationId);results.push({mlb:row.mlb,success:invoice?.status===true,message:`SKU ${row.sku}: dados enviados e vinculados. ${invoice?.status===true?'Emissão fiscal habilitada.':'A emissão fiscal ainda exige conferência.'}`});}catch(error){results.push({mlb:row.mlb,success:false,message:`SKU ${row.sku}: ${fiscalFailure(error,stage)}`});break;}}
  return {success:results.length===plan.rows.length&&results.every(row=>row.success),message:results.map(row=>row.message).join('\n'),results,destination:'/anuncios'};
 }
}
