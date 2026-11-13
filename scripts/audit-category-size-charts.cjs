require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const {HttpService}=require('@nestjs/axios');
const {ConfigService}=require('@nestjs/config');
const {MercadoLivreAuthService}=require('../apps/backend/dist/src/mercadolivre/auth/mercadolivre-auth.service');
const {MercadoLivreClient}=require('../apps/backend/dist/src/mercadolivre/mercadolivre.client');
const {sizeChartPolicy}=require('../apps/backend/dist/src/chat/size-chart-policy');
const p=new PrismaClient();
(async()=>{
 const listings=await p.marketplaceListing.findMany({where:{marketplaceAccount:{id:'meli-mottum-oauth',active:true}},select:{itemId:true,rawData:true}});
 const categories=new Map();for(const listing of listings){const item=listing.rawData;if(item?.category_id&&item?.domain_id){const group=categories.get(item.category_id)??{item,count:0};group.count++;categories.set(item.category_id,group);}}
 const http=new HttpService();const client=new MercadoLivreClient(http);const token=await new MercadoLivreAuthService(http,new ConfigService(),p).getValidAccessToken('meli-mottum-oauth');
 const domains=await client.getSizeChartDomains(token);client.getSizeChartDomains=async()=>domains;
 if(process.argv.includes('--specs')){for(const domain of ['MLB-SNEAKERS','MLB-JACKETS_AND_COATS']){const response=await require('rxjs').firstValueFrom(http.get('https://api.mercadolibre.com/domains/'+domain+'/technical_specs',{headers:{Authorization:'Bearer '+token}}));const found=[];const walk=value=>{if(!value||typeof value!=='object')return;if(['SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(value.id))found.push(value);for(const child of Object.values(value))if(typeof child==='object')walk(child);};walk(response.data);console.log(JSON.stringify({domain,grid:found},null,2));}return;}
 const report=[];for(const {item,count} of categories.values()){const policy=await sizeChartPolicy(client,token,item);report.push({...policy,listings:count});}
 console.log(JSON.stringify({categories:report.length,listings:listings.length,report},null,2));
})().catch(error=>{console.error('Read failed',error.response?.status??error.code??error.name);process.exitCode=1;}).finally(()=>p.$disconnect());
