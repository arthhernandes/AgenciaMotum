require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');const axios=require('axios');
const p=new PrismaClient();
(async()=>{
 const account=process.argv.includes('--source')?await p.marketplaceAccount.findFirst({where:{marketplace:'OLIST',businessKey:'outlet4u',active:true},orderBy:{updatedAt:'desc'}}):await p.marketplaceAccount.findUnique({where:{id:'olist-ts-comercio'}});
 const variant=await p.productVariant.findUnique({where:{olistAccountId_sku:{olistAccountId:account.id,sku:'2469.0006'}}});
 const base=process.env.OLIST_API_BASE_URL||'https://api.tiny.com.br/public-api/v3';
 console.log(JSON.stringify({source:account.businessKey,expires:account.tokenExpiresAt,hasRefresh:!!account.refreshToken}));
 if(process.argv.includes('--refresh')){
  const {HttpService}=require('@nestjs/axios');const {ConfigService}=require('@nestjs/config');const {OlistAuthService}=require('../apps/backend/dist/src/olist/olist-auth.service');
  const http=new HttpService();http.axiosRef.interceptors.response.use(value=>value,error=>{console.log(JSON.stringify({renewalStatus:error.response?.status,errorCode:error.response?.data?.error,reason:error.response?.data?.error_description?.slice(0,120)}));return Promise.reject(error);});
  try{account.accessToken=await new OlistAuthService(p,http,new ConfigService()).refreshAccess(account.id);console.log('Renewed');}catch{console.log('Renewal failed');return;}
 }
 for(const path of ['/produtos/'+variant.olistVariantId,'/estoque/'+variant.olistVariantId]){
  try{const response=await axios.get(base+path,{headers:{Authorization:'Bearer '+account.accessToken},timeout:15000});console.log(JSON.stringify({endpoint:path,status:response.status}));}
  catch(error){const data=error.response?.data;console.log(JSON.stringify({endpoint:path,status:error.response?.status,code:data?.error,description:typeof data?.error_description==='string'?data.error_description.slice(0,150):undefined}));}
 }
})().catch(error=>{console.error('Check failed',error.name);process.exitCode=1;}).finally(()=>p.$disconnect());
