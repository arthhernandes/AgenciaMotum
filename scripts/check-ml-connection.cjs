require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const {HttpService}=require('@nestjs/axios');
const {ConfigService}=require('@nestjs/config');
const {MercadoLivreAuthService}=require('../apps/backend/dist/src/mercadolivre/auth/mercadolivre-auth.service');
const {MercadoLivreClient}=require('../apps/backend/dist/src/mercadolivre/mercadolivre.client');
const prisma=new PrismaClient();
(async()=>{
 const account=await prisma.marketplaceAccount.findFirst({where:{marketplace:'MERCADO_LIVRE',businessKey:'mottum',active:true}});
 if(!account)throw new Error('Account not found');
 const http=new HttpService();const auth=new MercadoLivreAuthService(http,new ConfigService(),prisma);
 console.log(JSON.stringify({hasAccess:!!account.accessToken,hasRefresh:!!account.refreshToken,expiresAt:account.tokenExpiresAt}));
 try{
   let token=await auth.getValidAccessToken(account.id);
   const client=new MercadoLivreClient(http);let seller;
   try{seller=await client.getAuthenticatedSeller(token);}catch(error){if(error.response?.status!==401||!account.refreshToken)throw error;token=await auth.getValidAccessToken(account.id,true);seller=await client.getAuthenticatedSeller(token);}
   console.log(JSON.stringify({connected:String(seller.id)===account.sellerId}));
   if(process.argv.includes('--permissions')){
     const config=await auth.accountConfig(account.id);
     const response=await fetch(`https://api.mercadolibre.com/applications/${config.clientId}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
     const data=await response.json();console.log(JSON.stringify({applicationStatus:response.status,name:data.name,scopes:data.scopes??data.scopes_list??null}));
   }
 }catch(error){console.log(JSON.stringify({connected:false,status:error.response?.status??null,reason:/^[a-z_]{1,60}$/.test(error.response?.data?.error??'')?error.response.data.error:'unavailable'}));}
})().catch(()=>{console.error('Connection check failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
