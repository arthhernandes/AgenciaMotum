require('dotenv').config({quiet:true});const {PrismaClient}=require('@prisma/client');const {HttpService}=require('@nestjs/axios');const {ConfigService}=require('@nestjs/config');
const {MercadoLivreAuthService}=require('../apps/backend/dist/src/mercadolivre/auth/mercadolivre-auth.service');const {FinanceApi}=require('../apps/backend/dist/src/reports/finance-api');const p=new PrismaClient();
async function main(){const sku=process.argv[2]||'59327.14';
 const attempts=await p.auditLog.findMany({where:{action:'CHAT_PENDING_ACTION'},orderBy:{createdAt:'desc'},take:300,select:{id:true,createdAt:true,after:true}});
 const matches=attempts.filter(r=>r.after?.payload?.fiscal?.rows?.some(row=>row.sku===sku));
 for(const record of matches.slice(0,3)){const payload=record.after.payload,rows=payload.fiscal.rows.filter(row=>row.sku===sku),result=await p.auditLog.findFirst({where:{action:'CHAT_ACTION',entityId:payload.id},select:{after:true}});console.log(JSON.stringify({attempt:record.id,at:record.createdAt,status:record.after.status,account:payload.accountId,reference:payload.fiscal.reference,regime:payload.fiscal.regime,rows:rows.map(row=>({mlb:row.mlb,variationId:row.variationId,sku:row.sku,current:row.current,values:row.values})),result:result?.after}));}
 for(const account of await p.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true}})){
  const auth=new MercadoLivreAuthService(new HttpService(),new ConfigService(process.env),p);let token=await auth.getValidAccessToken(account.id);const api=new FinanceApi(async refresh=>{if(refresh)token=await auth.getValidAccessToken(account.id,true);return token;});
  try{const data=await api.get('/items/fiscal_information/'+encodeURIComponent(sku));console.log(JSON.stringify({account:account.businessKey,currentFiscal:data}));
   const mlb=matches.flatMap(record=>record.after.payload.fiscal.rows).find(row=>row.sku===sku)?.mlb;
   if(mlb){for(const path of ['/items/'+mlb+'/fiscal_information/detail','/can_invoice/items/'+mlb])try{console.log(JSON.stringify({account:account.businessKey,path,data:await api.get(path)}));}catch(e){console.log(JSON.stringify({path,error:e.message}));}}
  }catch(e){console.log(JSON.stringify({account:account.businessKey,error:e.message}));}
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
