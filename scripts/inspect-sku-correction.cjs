require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
const {HttpService}=require('@nestjs/axios');
const {ConfigService}=require('@nestjs/config');
const {MercadoLivreAuthService}=require('../apps/backend/dist/src/mercadolivre/auth/mercadolivre-auth.service');
const {MercadoLivreClient}=require('../apps/backend/dist/src/mercadolivre/mercadolivre.client');
const sku=raw=>({custom:raw?.seller_custom_field,attribute:raw?.attributes?.find(a=>a.id==='SELLER_SKU')});
(async()=>{
 const listing=await p.marketplaceListing.findFirst({where:{itemId:'MLB4510949383'},include:{marketplaceAccount:true,variants:true,links:{include:{productVariant:true}}}});
 if(process.argv.includes('--live')&&listing){const http=new HttpService();const auth=new MercadoLivreAuthService(http,new ConfigService(),p);const token=await auth.getValidAccessToken(listing.marketplaceAccountId);const item=await new MercadoLivreClient(http).getItem(token,listing.itemId);console.log(JSON.stringify({live:item.id,shipping:item.shipping,variants:item.variations?.map(v=>({id:v.id,...sku(v)}))},null,2));}
 const logs=await p.auditLog.findMany({where:{entityId:'MLB4510949383',action:'CHAT_ML_UPDATE_DETAIL'},orderBy:{createdAt:'desc'},take:5});
 console.log(JSON.stringify({listing:listing&&{id:listing.id,raw:sku(listing.rawData),variants:listing.variants.map(v=>({id:v.variationId,sku:v.sku,raw:sku(v.rawData)})),links:listing.links.map(l=>({variant:l.listingVariantId,sku:l.productVariant?.sku}))},logs:logs.map(l=>({createdAt:l.createdAt,before:l.before,after:l.after}))},null,2));
})().catch(()=>{console.error('Inspection failed');process.exitCode=1}).finally(()=>p.$disconnect());
