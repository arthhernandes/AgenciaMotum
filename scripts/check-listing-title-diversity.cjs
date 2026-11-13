require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const {HttpService}=require('@nestjs/axios');
const {ConfigService}=require('@nestjs/config');
const {ListingDuplicationTitlesService}=require('../apps/backend/dist/src/chat/listing-duplication-titles.service');
const {listingTitleBrandProblem,listingTitleContentProblem,listingTitleIdentityProblem,listingTitleSimilarity,tooSimilarListingTitle}=require('../apps/backend/dist/src/chat/listing-title-diversity');
const prisma=new PrismaClient();
(async()=>{
 const source=await prisma.marketplaceListing.findFirst({where:{marketplaceAccountId:'meli-mottum-oauth',title:{contains:'Camiseta Masculina Importada',mode:'insensitive'}},select:{rawData:true}});
 const item=source?.rawData;
 const original=item?.family_name||'Camiseta Masculina Importada Polo Rl Original Clássica Lisa';
 const allowed=new Set(['BRAND','MODEL','GENDER','MAIN_MATERIAL','COMPOSITION','FABRIC_TYPE','NECK_TYPE','SLEEVE_LENGTH','CLOTHING_LENGTH','FIT','PATTERN','FABRIC_DESIGN','AGE_GROUP','STYLE']);
 const facts=(item?.attributes??[]).filter(a=>allowed.has(a.id)&&(a.value_name||a.values?.[0]?.name)).map(a=>({name:a.name||a.id,value:a.value_name||a.values?.[0]?.name}));
 const http=new HttpService();
 if(process.argv.includes('--inspect'))http.axiosRef.interceptors.response.use(response=>{
  const raw=response.data.choices?.[0]?.message?.content||(response.data.output??[]).flatMap(item=>item.content??[]).filter(item=>item.type==='output_text').map(item=>item.text).join('');
  try{const output=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));console.log(JSON.stringify({attemptTitles:output.titles?.map(title=>({title,problem:listingTitleIdentityProblem(title,original,facts)||listingTitleContentProblem(title,original,facts)}))}));}catch{console.log(JSON.stringify({invalidJson:true}));}return response;
 });
 const titles=await new ListingDuplicationTitlesService(new ConfigService(),http).generate(original,2,60,facts);
 if(titles.length!==2)throw Error('Wrong title count');
 titles.forEach((title,index)=>{if(listingTitleIdentityProblem(title,original,facts)||listingTitleContentProblem(title,original,facts)||tooSimilarListingTitle(title,[original,...titles.slice(0,index)],facts))throw Error('Invalid generated title');});
 console.log(JSON.stringify({original,titles,usedConfirmedCatalogFacts:!!source,brandsAbsent:titles.every(title=>!listingTitleBrandProblem(title,original,facts)),onlySupportedCharacteristics:true,similarityToOriginal:titles.map(title=>Number(listingTitleSimilarity(title,original).toFixed(2))),realListingsCreated:0},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
