import { ForbiddenException } from '@nestjs/common';

export const PERMISSION_AREAS=[
  {id:'dashboard',label:'Resumo',manage:false},
  {id:'reports',label:'Relatórios',manage:false},
  {id:'audit',label:'Auditoria de anúncios',manage:true,action:'Executar auditorias'},
  {id:'pending',label:'Central de pendências',manage:false},
  {id:'listings',label:'Anúncios e vínculos',manage:true,action:'Editar, vincular SKU, duplicar, publicar e alterar dados fiscais'},
  {id:'map',label:'Mapa de vínculos e catálogo Bling',manage:false},
  {id:'costs',label:'Custos dos produtos',manage:false,action:'Consultar custos de compra e aquisição, inclusive na revisão fiscal completa'},
  {id:'templates',label:'Modelos fiscais',manage:true,action:'Criar, editar e arquivar modelos'},
  {id:'sync',label:'Sincronizações',manage:true,action:'Iniciar, pausar, retomar e cancelar'},
  {id:'chat',label:'Assistente IA',manage:true,action:'Confirmar ações pelo assistente (exige também a permissão da área)'},
  {id:'connections',label:'Contas conectadas',manage:true,action:'Conectar e desconectar integrações'},
  {id:'settings',label:'Configurações',manage:false}
] as const;
export const PERMISSION_KEYS=PERMISSION_AREAS.flatMap(area=>[area.id+'.view',...(area.manage?[area.id+'.manage']:[])]);
export function defaultPermissions(role:string){return role==='ADMIN'?[...PERMISSION_KEYS]:PERMISSION_KEYS.filter(key=>key!=='costs.view'&&(role==='CONSULTANT'||key.endsWith('.view')));}
export function effectivePermissions(user:{role:string;permissions?:unknown}):string[]{
  if(user.role==='ADMIN')return [...PERMISSION_KEYS];
  return Array.isArray(user.permissions)?user.permissions.filter((key):key is string=>typeof key==='string'&&PERMISSION_KEYS.includes(key)):defaultPermissions(user.role);
}
export function normalizePermissions(values:string[]){
  const keys=new Set(values.flatMap(key=>key.endsWith('.manage')?[key,key.replace('.manage','.view')]:[key]));
  if(keys.has('chat.view'))keys.add('listings.view');
  return [...keys].sort();
}
export function assertPermissions(user:{role:string;permissions?:unknown},...keys:string[]){
  if(!keys.every(key=>effectivePermissions(user).includes(key)))throw new ForbiddenException('Seu usuário não tem permissão para esta área ou ação.');
}
export async function requireUserPermission(db:any,id:string,key:string){
  const user=await db.user.findUnique({where:{id},select:{active:true,role:true,permissions:true}});
  if(!user?.active)throw new ForbiddenException('Seu acesso está desativado.');
  assertPermissions(user,key);
  return user;
}

/** Alternatives are OR; every key inside an alternative is required. Unknown routes fail closed. */
export function routePermissions(method:string,path:string):string[][] {
  const p=path.replace(/^\/api(?=\/)/,'').replace(/\/$/,'');const read=method==='GET';
  if(p==='/auth/me'||(p==='/marketplace-accounts/business'&&read))return [[]];
  if(p==='/marketplace-accounts/business')return [['ADMIN']];
  if(p.startsWith('/users'))return [['ADMIN']];
  if(p.startsWith('/dashboard'))return [['dashboard.view']];
  if(p==='/reports'&&read)return [['reports.view']];
  if(p==='/reports/profitability/inputs'&&(read||method==='POST'))return [['reports.view','costs.view']];
  if(p==='/reports/profitability/refresh-listing'&&method==='POST')return [['reports.view','costs.view','listings.manage']];
  if(p==='/reports/profitability/advertising-allocation'&&read)return [['reports.view','costs.view']];
  if(p==='/reports/profitability/import-advertising-allocation'&&method==='POST')return [['reports.view','costs.view']];
  if((p==='/reports/profitability/advertising-summary'&&read)||(p==='/reports/profitability/import-advertising-summary'&&method==='POST'))return [['reports.view','costs.view']];
  if((p==='/reports/profitability/import-costs'||p==='/reports/profitability/import-advertising')&&method==='POST')return [['reports.view','costs.view']];
  if((p==='/reports/profitability'||p==='/reports/profitability/advertising'||p==='/reports/profitability/enrichment-status')&&read)return [['reports.view','costs.view']];
  if(p==='/listings/visits')return [['listings.view'],['map.view'],['audit.view'],['reports.view']];
  if(p.startsWith('/audit'))return [[read?'audit.view':'audit.manage']];
  if(p==='/operations/pending')return [['pending.view']];
  if(p.startsWith('/operations/fiscal-templates'))return [[read?'templates.view':'templates.manage']];
  if(p.startsWith('/sync'))return [[read?'sync.view':'sync.manage']];
  if(p.startsWith('/mercadolivre/auth/authorize')||p.startsWith('/bling/auth/authorize'))return [['connections.manage']];
  if(p.startsWith('/marketplace-accounts')||p==='/bling/account')return read?[['connections.view'],['settings.view'],['sync.view']]:[['connections.manage']];
  if(/^\/products\/[^/]+\/costs$/.test(p))return [['costs.view','map.view'],['costs.view','listings.view']];
  if(p.startsWith('/products')||p.startsWith('/product-variants'))return [['map.view'],['listings.view'],['audit.view']];
  if(p.startsWith('/listings'))return [['listings.view'],['map.view'],['audit.view']];
  if(p.startsWith('/listing-links'))return [[read?'listings.view':'listings.manage']];
  if(p.startsWith('/ncm'))return [['templates.view'],['listings.view']];
  if(p.startsWith('/chat/listing-creation'))return [['listings.manage']];
  if(p.startsWith('/chat/listing-editor')||p.startsWith('/chat/listing-duplication')||p.startsWith('/chat/listing-variations'))return [[read?'listings.view':'listings.manage']];
  if(p==='/chat/listing-fiscal'||/^\/chat\/actions\/[^/]+\/(listing-ncm|ncm|fiscal)$/.test(p))return [['listings.manage','costs.view']];
  if(p.startsWith('/chat/size-charts')||/^\/chat\/actions\/[^/]+\/(size-chart|revise|refresh)$/.test(p))return [['listings.manage']];
  if(/^\/chat\/actions\/[^/]+\/(confirm|cancel)$/.test(p))return [['listings.manage'],['chat.manage']];
  if(p.startsWith('/chat/publications'))return [['listings.view'],['chat.view']];
  if(p.startsWith('/chat/batches'))return [[read?'chat.view':'chat.manage']];
  if(p==='/chat/interpretation/examples')return [['ADMIN']];
  if(p.startsWith('/chat'))return [['chat.view']];
  return [];
}
export function assertRoutePermissions(user:{role:string;permissions?:unknown},method:string,path:string){
  if(user.role==='ADMIN')return;
  const permissions=effectivePermissions(user);
  if(!routePermissions(method,path).some(keys=>keys.every(key=>permissions.includes(key))))throw new ForbiddenException('Seu usuário não tem permissão para esta área ou ação.');
}
