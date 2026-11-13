import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { confirmPublicationStatus } from './listing-publication-status';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreClient } from '../mercadolivre/mercadolivre.client';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';
import { BlingSyncService } from '../bling/synchronization/bling-sync.service';
import { ChatMarketplaceService } from './chat-marketplace.service';
import { ChatPendingActionsService } from './chat-pending-actions.service';
import { CreationChartDraftDto, CreationChartSaveDto, CreationChartsDto, CreationCopyDto, CreationDraftDto } from './listing-creation.dto';
import { ChatSizeChartCreationService } from './chat-size-chart-creation.service';
import { ListingCopyService } from './listing-copy.service';
import { listingPackageFields, normalizeListingPackageValue } from './listing-package-attributes';
import { ChatSizeCharts, chartSizeKey, createdSizeCharts } from './chat-size-charts';
import { copyAttributesMatch, duplicationError, duplicationWarnings, titleKey } from './listing-duplication-model';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';

const ACTION='LISTING_CREATION_JOB';
const json=(v:any)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const managed=new Set(['SELLER_SKU','GTIN','COLOR','SIZE','SIZE_GRID_ID','SIZE_GRID_ROW_ID','ITEM_CONDITION']);
const tagged=(a:any,key:string)=>Array.isArray(a.tags)?a.tags.includes(key):a.tags?.[key]===true;
const version=(source:any)=>createHash('sha256').update(JSON.stringify({product:source.product,rows:source.rows?.map(({stock,...row}:any)=>row)})).digest('hex');

@Injectable()
export class ListingCreationService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;private busy=false;
  constructor(private readonly prisma:PrismaService,private readonly client:MercadoLivreClient,private readonly auth:MercadoLivreAuthService,private readonly bling:BlingSyncService,private readonly market:ChatMarketplaceService,private readonly pending:ChatPendingActionsService,private readonly copy:ListingCopyService,private readonly chartCreation:ChatSizeChartCreationService){}
  onModuleInit(){this.timer=setInterval(()=>void this.tick().catch(()=>undefined),5000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  private async context(accountId:string,userId:string){
    await this.market.authorizeFiscal(userId);
    const business=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:'BLING',active:true}});
    if(!business)throw new BadRequestException('Selecione uma conta Bling válida.');
    const accounts=await this.prisma.marketplaceAccount.findMany({where:{businessKey:business.businessKey,marketplace:'MERCADO_LIVRE',active:true}});
    if(accounts.length!==1||!accounts[0].sellerId)throw new BadRequestException('Identifique uma única conta Mercado Livre conectada para esta empresa.');
    const account=accounts[0],token=await this.auth.getValidAccessToken(account.id);
    const seller=await this.client.getAuthenticatedSeller(token);
    if(String(seller.id)!==account.sellerId)throw new BadRequestException('A conexão não corresponde ao vendedor desta conta. Reconecte o Mercado Livre.');
    const profile=await this.client.getSeller(token,account.sellerId!);
    let warehouse:any=null;
    if(profile.tags?.includes('warehouse_management')){
      const stores=(await this.client.getWarehouses(token,account.sellerId!)).filter((s:any)=>s.status==='active'&&String(s.user_id)===account.sellerId);
      if(stores.length!==1||!stores[0].network_node_id)throw new BadRequestException('É necessário identificar um único depósito ativo para publicar com o estoque correto.');
      warehouse={store_id:String(stores[0].id),network_node_id:String(stores[0].network_node_id)};
    }
    return {business,account,token,userProducts:!!profile.tags?.includes('user_product_seller'),warehouse};
  }
  async lookup(accountId:string,userId:string,sku:string){
    const context=await this.context(accountId,userId),source=await this.bling.publicationSource(accountId,sku);
    if(source.matches)return {matches:source.matches};
    let categories:any[]=[],categoryMessage='';
    try{
      const predicted=await this.client.predictCategories(context.token,source.product!.title);
      const checked=await Promise.allSettled(predicted.map(async suggestion=>{const details=await this.client.category(context.token,suggestion.category_id);return {...suggestion,path:(details.category.path_from_root??[]).map((node:any)=>node.name).join(' › ')||details.category.name};}));
      categories=checked.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
      if(checked.some(result=>result.status==='rejected'))categoryMessage='Não foi possível conferir o caminho de algumas categorias. Busque o produto novamente para atualizar as sugestões.';
    }catch{categoryMessage='Não foi possível sugerir a categoria. Informe o código da categoria do Mercado Livre.';}
    return {...source,version:version(source),categories,categoryMessage,seller:context.account.name,userProducts:context.userProducts};
  }
  private async definition(token:string,categoryId:string){
    if(!/^MLB\d+$/.test(categoryId??''))throw new BadRequestException('Informe uma categoria válida.');
    const result=await this.client.category(token,categoryId);
    if(result.category?.children_categories?.length||result.category?.settings?.listing_allowed===false)throw new BadRequestException('Selecione a categoria final que permite publicar este produto.');
    return result;
  }
  async generateCopy(accountId:string,userId:string,input:CreationCopyDto){
    const c=await this.context(accountId,userId),source=await this.bling.publicationSource(accountId,input.sku);
    if(!source.product||version(source)!==input.version)throw new ConflictException('Os dados da Bling mudaram. Busque o SKU novamente.');
    const d=await this.definition(c.token,input.categoryId),skus=new Set(input.rows.map(r=>r.sku)),rows=source.rows!.filter(r=>skus.has(r.sku));
    if(!rows.length||rows.length!==skus.size)throw new BadRequestException('Selecione as variações deste produto.');
    const facts=input.attributes.filter(a=>a.value.trim()&&!/^SELLER_PACKAGE_|^EMPTY_GTIN_REASON$/.test(a.id)).map(a=>{
      const def=d.attributes.find((v:any)=>v.id===a.id);
      if(!def||managed.has(a.id)||tagged(def,'read_only'))throw new BadRequestException('Característica inválida: '+a.id);
      if(a.valueId&&!def.values?.some((v:any)=>String(v.id)===a.valueId&&v.name===a.value))throw new BadRequestException('Confira o valor de '+def.name);
      return {name:def.id==='BRAND'?'Marca':def.name,value:a.value.trim()};
    });
    return this.copy.generate({title:source.product.title,description:source.product.description,brand:facts.find(a=>a.name==='Marca')?.value||source.product.brand,sku:source.product.sku,facts,colors:[...new Set(source.rows!.map(r=>r.color).filter(Boolean))] as string[],sizes:[...new Set(source.rows!.map(r=>r.size).filter(Boolean))] as string[],hasVariations:source.rows!.length>1,max:d.category.settings?.max_title_length??60});
  }
  async category(accountId:string,userId:string,id:string){
    const c=await this.context(accountId,userId),d=await this.definition(c.token,id);
    return {id,name:d.category.name,path:(d.category.path_from_root??[]).map((node:any)=>node.name).join(' › ')||d.category.name,maxTitleLength:d.category.settings?.max_title_length??60,chartSupported:d.attributes.some((a:any)=>a.id==='SIZE_GRID_ID'),chartRequired:d.attributes.some((a:any)=>['SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(a.id)&&(tagged(a,'required')||tagged(a,'conditional_required'))),attributes:d.attributes.filter((a:any)=>!managed.has(a.id)&&!tagged(a,'read_only')).map((a:any)=>({id:a.id,name:listingPackageFields[a.id]?.name??a.name,required:tagged(a,'required')||!!listingPackageFields[a.id],conditional:tagged(a,'conditional_required'),values:a.values??[],type:a.value_type}))};
  }
  private chartSource(c:any,d:any,attributes:any[]){
    const domain=d.category.settings?.catalog_domain??d.category.domain_id;
    if(!domain)throw new BadRequestException('A categoria não informou o domínio necessário para consultar a tabela de medidas.');
    const parent=attributes.filter(a=>['BRAND','GENDER'].includes(a.id)).map(a=>({id:a.id,value:a.value_id??a.value_name})).sort((a,b)=>a.id.localeCompare(b.id));
    const id='creation:'+createHash('sha256').update(JSON.stringify({accountId:c.business.id,mlAccountId:c.account.id,category:d.category.id,parent})).digest('hex');
    return {token:c.token,account:{...c.account,sellerId:c.account.sellerId!},item:{id,category_id:d.category.id,domain_id:String(domain),attributes}};
  }
  private async chartDraftContext(accountId:string,userId:string,input:CreationChartDraftDto){
    const c=await this.context(accountId,userId),source=await this.bling.publicationSource(accountId,input.sku);
    if(!source.product||version(source)!==input.version)throw new ConflictException('O produto da Bling mudou. Busque o SKU novamente.');
    const d=await this.definition(c.token,input.categoryId),skus=[...new Set(input.rows.map(row=>row.sku))].sort(),rows=source.rows!.filter(row=>skus.includes(row.sku));
    if(!rows.length||rows.length!==skus.length||rows.some(row=>!row.size))throw new BadRequestException('Selecione variações da Bling com tamanhos identificados.');
    const attributes=input.attributes.filter(a=>a.value.trim()).map(a=>{
      const def=d.attributes.find((v:any)=>v.id===a.id);
      if(!def||managed.has(a.id)||tagged(def,'read_only')||a.valueId&&!def.values?.some((v:any)=>String(v.id)===a.valueId&&v.name===a.value))throw new BadRequestException('Confira a característica '+a.id);
      return {id:a.id,value_name:a.value,...(a.valueId?{value_id:a.valueId}:{})};
    });
    const chartSource=this.chartSource(c,d,attributes),sizes=[...new Set(rows.map(row=>row.size!))];
    const key=createHash('sha256').update(JSON.stringify({source:chartSource.item.id,version:input.version,sku:input.sku,skus,measureType:input.measureType})).digest('hex');
    return {chartSource,sizes,key,productName:source.product.title};
  }
  async prepareChart(accountId:string,userId:string,input:CreationChartDraftDto){
    const ctx=await this.chartDraftContext(accountId,userId,input);
    return this.chartCreation.prepareForCreation(accountId,userId,ctx.chartSource,ctx.productName,ctx.sizes,input.measureType,ctx.key);
  }
  async saveChart(accountId:string,userId:string,id:string,input:CreationChartSaveDto){
    if(!input.context)throw new BadRequestException('Informe o produto e a categoria da tabela.');
    const ctx=await this.chartDraftContext(accountId,userId,input.context);
    return this.chartCreation.createForCreation(id,accountId,userId,input.rows,ctx.chartSource,ctx.key);
  }
  async charts(accountId:string,userId:string,input:CreationChartsDto){
    const c=await this.context(accountId,userId),d=await this.definition(c.token,input.categoryId),source=await this.bling.publicationSource(accountId,input.sku);
    const wanted=new Set(input.rows.map(r=>r.sku));
    if(!source.rows||input.rows.some(row=>!source.rows!.some(r=>r.sku===row.sku)))throw new BadRequestException('Selecione as variações do produto Bling correto.');
    const context=this.chartSource(c,d,input.attributes.map(a=>({id:a.id,value_name:a.value,...(a.valueId?{value_id:a.valueId}:{})})));
    return new ChatSizeCharts(this.client,await createdSizeCharts(this.prisma,accountId,context.item.id)).list(context,source.rows!.filter(r=>wanted.has(r.sku)).map(r=>r.size).filter(Boolean) as string[]);
  }
  async upload(accountId:string,userId:string,file?:{buffer:Buffer;mimetype:string}){
    const c=await this.context(accountId,userId);
    if(!file?.buffer?.length)throw new BadRequestException('O arquivo da foto não chegou ao servidor ou está vazio. Escolha a imagem e envie novamente.');
    if(file.buffer.length>10*1024*1024)throw new BadRequestException('A foto ultrapassa o limite de 10 MB por arquivo.');
    const png=file?.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=file?.buffer[0]===255&&file?.buffer[1]===216&&file?.buffer[2]===255;
    if(!png&&!jpeg)throw new BadRequestException('A imagem recebida não está codificada em JPG ou PNG. Escolha novamente a foto para que o sistema faça a conversão antes do envio.');
    const photo=await this.client.uploadPicture(c.token,file.buffer,png?'image/png':'image/jpeg');
    if(!/^\d+-ML[A-Z]\d+_\d+$/.test(photo.id??''))throw new BadRequestException('O Mercado Livre não confirmou a foto enviada.');
    const url=photo.variations?.find((variation:any)=>/^https:\/\//i.test(variation.secure_url??''))?.secure_url;
    if(!url)throw new BadRequestException('O Mercado Livre não confirmou a prévia da foto enviada. Tente novamente.');
    return {id:photo.id,url};
  }
  private photos(values:string[]){
    return [...new Set(values.map(value=>value.trim()))].map(value=>{
      if(/^\d+-ML[A-Z]\d+_\d+$/.test(value))return {id:value};
      let u:URL;try{u=new URL(value);}catch{throw new BadRequestException('Use fotos JPG/PNG enviadas ou URLs HTTPS públicas.');}
      if(u.protocol!=='https:'||u.username||u.password||u.hash||/^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(u.hostname)||u.hostname.endsWith('.local'))throw new BadRequestException('A URL da foto deve ser HTTPS e pública.');
      return {source:value};
    });
  }
  private async uniqueName(accountId:string,title:string){
    const existing=await this.prisma.marketplaceListing.findMany({where:{marketplaceAccountId:accountId},select:{title:true,rawData:true}});
    if(existing.some(row=>titleKey((row.rawData as any)?.family_name||row.title)===titleKey(title)))throw new BadRequestException('Este nome já está em uso. Escolha outro para criar uma nova família de anúncios.');
  }
  private async validate(token:string,body:any){
    try{await this.client.validateItem(token,body);return [] as string[];}catch(error){const warnings=duplicationWarnings(error);if(warnings)return warnings;throw new BadRequestException(duplicationError(error));}
  }
  private async plan(accountId:string,userId:string,input:CreationDraftDto){
    const c=await this.context(accountId,userId),source=await this.bling.publicationSource(accountId,input.sku);
    if(source.matches||version(source)!==input.version)throw new ConflictException('Os dados da Bling mudaram. Busque o SKU novamente para revisar.');
    const d=await this.definition(c.token,input.categoryId),title=input.title.trim();
    if(title.length<5||title.length>(d.category.settings?.max_title_length??60))throw new BadRequestException('Revise o tamanho do título para esta categoria.');
    await this.uniqueName(c.account.id,title);
    if(!input.rows.length||new Set(input.rows.map(r=>r.sku)).size!==input.rows.length)throw new BadRequestException('Selecione variações sem SKUs repetidos.');
    const available=new Map(source.rows!.map(row=>[row.sku,row]));
    const attributes=input.attributes.filter(a=>a.value.trim()).map(a=>{
      const def=d.attributes.find((v:any)=>v.id===a.id);
      if(!def||managed.has(a.id)||tagged(def,'read_only'))throw new BadRequestException('Característica inválida: '+a.id);
      if(a.valueId&&!def.values?.some((v:any)=>String(v.id)===a.valueId&&v.name===a.value))throw new BadRequestException('Selecione um valor válido para '+def.name);
      return {id:a.id,...(listingPackageFields[a.id]?{value_name:normalizeListingPackageValue(a.id,a.value)}:a.valueId?{value_id:a.valueId}:{value_name:a.value.trim()})};
    });
    if(new Set(attributes.map(a=>a.id)).size!==attributes.length)throw new BadRequestException('Há características repetidas.');
    const missing=d.attributes.filter((a:any)=>(tagged(a,'required')||!!listingPackageFields[a.id])&&!tagged(a,'read_only')&&!managed.has(a.id)&&!attributes.some(v=>v.id===a.id));
    if(missing.length)throw new BadRequestException('Preencha: '+missing.map((a:any)=>listingPackageFields[a.id]?.name??a.name).join(', '));
    let chart:any;
    const chartRequired=d.attributes.some((a:any)=>['SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(a.id)&&(tagged(a,'required')||tagged(a,'conditional_required')));
    if(chartRequired&&!input.sizeChartId)throw new BadRequestException('Selecione uma tabela de medidas compatível.');
    if(input.sizeChartId){const ctx=this.chartSource(c,d,attributes);chart=await new ChatSizeCharts(this.client,await createdSizeCharts(this.prisma,accountId,ctx.item.id)).select(ctx,input.sizeChartId,input.rows.map(r=>available.get(r.sku)?.size??'').filter(Boolean));}
    if(chart&&input.rows.some(r=>!available.get(r.sku)?.size))throw new BadRequestException('Preencha o tamanho de todas as variações na Bling antes de usar uma tabela de medidas.');
    const rows:any[]=[];
    for(const requested of input.rows){
      const row=available.get(requested.sku);if(!row)throw new BadRequestException('SKU fora do produto Bling: '+requested.sku);
      const pictures=this.photos(requested.photos??input.photos);
      if(!pictures.length||pictures.length>Math.min(12,d.category.settings?.max_pictures_per_item??12))throw new BadRequestException('Adicione de 1 a 12 fotos válidas para o SKU '+row.sku+', respeitando o limite da categoria.');
      if(!Number.isFinite(requested.price)||requested.price<=0||Math.abs(requested.price*100-Math.round(requested.price*100))>.0001)throw new BadRequestException('Informe um preço válido para '+row.sku);
      const stock=(await this.bling.liveStockForSku(accountId,row.sku)).publishable;
      const own=[{id:'SELLER_SKU',value_name:row.sku},...(row.color?[{id:'COLOR',value_name:row.color}]:[]),...(row.size?[{id:'SIZE',value_name:row.size}]:[]),...(requested.gtin?.trim()?[{id:'GTIN',value_name:requested.gtin.trim()}]:[]),...(chart?[{id:'SIZE_GRID_ID',value_name:chart.id},{id:'SIZE_GRID_ROW_ID',value_name:chart.rows[chartSizeKey(row.size)]}]:[])];
      const body:any={site_id:'MLB',[c.userProducts?'family_name':'title']:title,category_id:input.categoryId,currency_id:'BRL',buying_mode:'buy_it_now',listing_type_id:input.listingTypeId,condition:input.condition,price:requested.price,available_quantity:c.warehouse?0:stock,status:'paused',shipping:{mode:'me2',free_shipping:input.freeShipping},pictures,attributes:[...attributes.filter(a=>a.id!=='EMPTY_GTIN_REASON'||!requested.gtin?.trim()),...own]};
      rows.push({sku:row.sku,productVariantId:row.id,price:requested.price,stock,body,state:'PENDING',mlb:null,message:''});
    }
    if(!c.userProducts&&rows.length>1){
      if(c.warehouse)throw new BadRequestException('A conta precisa concluir a migração para User Products antes de publicar várias variações com depósitos.');
      if(rows.some(row=>row.price!==rows[0].price))throw new BadRequestException('Esta conta exige o mesmo preço para todas as variações.');
      const combinations=new Set<string>();
      const variations=rows.map(row=>{
        const combination=row.body.attributes.filter((a:any)=>['COLOR','SIZE'].includes(a.id));
        if(!combination.length)throw new BadRequestException('As variações precisam de cor ou tamanho na Bling.');
        const key=JSON.stringify(combination);if(combinations.has(key))throw new BadRequestException('A Bling possui variações com a mesma cor e tamanho. Confira a grade.');combinations.add(key);
        return {price:row.price,available_quantity:row.stock,attribute_combinations:combination,attributes:row.body.attributes.filter((a:any)=>['SELLER_SKU','GTIN','EMPTY_GTIN_REASON','SIZE_GRID_ROW_ID'].includes(a.id)),picture_ids:row.body.pictures.map((p:any)=>p.id??p.source)};
      });
      const pictures=[...new Map<string,any>(rows.flatMap(row=>row.body.pictures).map((picture:any)=>[picture.id??picture.source,picture])).values()];
      if(pictures.length>(d.category.settings?.max_pictures_per_item??12))throw new BadRequestException('As fotos de todas as variações ultrapassam o limite total desta categoria. Remova fotos repetidas ou reduza a quantidade antes de publicar.');
      const body={...rows[0].body,pictures,attributes:[...attributes.filter(a=>a.id!=='EMPTY_GTIN_REASON'),...(chart?[{id:'SIZE_GRID_ID',value_name:chart.id}]:[])],available_quantity:undefined,variations};
      rows.splice(0,rows.length,{sku:source.product!.sku,body,stock:rows.reduce((sum,row)=>sum+row.stock,0),price:rows[0].price,selectedSkus:input.rows.map(r=>r.sku),state:'PENDING',mlb:null,message:''});
    }
    const warnings=new Set<string>();for(const row of rows)for(const warning of await this.validate(c.token,row.body))warnings.add(warning);
    if(!input.freeShipping&&[...warnings].some(w=>w.includes('exige frete grátis')))throw new BadRequestException('O Mercado Livre exige frete grátis nesta publicação. Marque a opção e revise novamente.');
    return {c,source,title,rows,warnings:[...warnings],categoryName:d.category.name};
  }
  async prepare(accountId:string,userId:string,input:CreationDraftDto){
    const p=await this.plan(accountId,userId,input),id=randomUUID();
    await this.pending.save({id,purpose:'LISTING_CREATION',accountId,userId,input,version:input.version,title:p.title,rows:p.rows,warehouse:p.c.warehouse,userProducts:p.c.userProducts,mlAccount:{id:p.c.account.id,sellerId:p.c.account.sellerId},expiresAt:Date.now()+15*60_000});
    return {id,title:p.title,category:p.categoryName,seller:p.c.account.name,totalOffers:p.rows.length,warnings:p.warnings,description:input.description,photos:[...new Set(input.rows.flatMap(row=>row.photos??input.photos))],rows:input.rows.map(row=>({...row,photos:row.photos??input.photos,stock:p.rows.find(r=>r.sku===row.sku)?.stock??p.rows[0].body.variations?.find((v:any)=>sellerSku(v)===row.sku)?.available_quantity})),listingTypeId:input.listingTypeId,freeShipping:input.freeShipping};
  }
  async confirm(accountId:string,userId:string,id:string){
    await this.market.authorizeFiscal(userId);
    const jobId='creation:'+id,previous=await this.prisma.auditLog.findFirst({where:{id:jobId,action:ACTION,entityId:accountId,userId}});
    if(previous)return {jobId};
    const saved=await this.pending.load(id,accountId,userId);
    if(saved?.purpose!=='LISTING_CREATION'||saved.expiresAt<Date.now())throw new NotFoundException('A revisão expirou. Revise novamente.');
    await this.prisma.$transaction(async tx=>{
      const claimed=await tx.auditLog.updateMany({where:{id,action:'CHAT_PENDING_ACTION',entityType:'PendingChatAction',entityId:accountId,userId,after:{path:['status'],equals:'PENDING'}},data:{after:json({status:'CLAIMED',payload:saved})}});
      if(claimed.count!==1)throw new ConflictException('A publicação já foi confirmada. Atualize o acompanhamento.');
      await tx.auditLog.create({data:{id:jobId,action:ACTION,entityType:'ListingCreation',entityId:accountId,userId,after:json({...saved,status:'QUEUED',message:'Publicação confirmada. Conferindo os dados.'})}});
    });return {jobId};
  }
  async status(accountId:string,userId:string,id:string){
    await this.market.authorizeFiscal(userId);
    const record=await this.prisma.auditLog.findFirst({where:{id,action:ACTION,entityId:accountId,userId}});
    if(!record)throw new NotFoundException('Publicação não encontrada nesta conta.');
    const job=record.after as any;
    return {jobId:id,status:job.status,message:job.message,total:job.rows.length,completed:job.rows.filter((r:any)=>r.state==='SUCCESS').length,rows:job.rows.map((r:any)=>({sku:r.sku,mlb:r.mlb,state:r.state,message:r.message}))};
  }
  private save(id:string,job:any){job.leaseUntil=Date.now()+15*60_000;return this.prisma.auditLog.update({where:{id},data:{after:json(job)}});}
  async tick(){
    if(this.busy)return;this.busy=true;
    try{
      const record=await this.prisma.auditLog.findFirst({where:{action:ACTION,OR:[{after:{path:['status'],equals:'QUEUED'}},{after:{path:['status'],equals:'RUNNING'}}]},orderBy:{createdAt:'asc'}});
      if(!record)return;const job=structuredClone(record.after) as any;
      if(job.status==='RUNNING'){
        if(job.leaseUntil>Date.now())return;
        await this.prisma.auditLog.updateMany({where:{id:record.id,after:{equals:record.after as Prisma.InputJsonValue}},data:{after:json({...job,status:'NEEDS_REVIEW',message:'O processamento foi interrompido. Confira os anúncios criados antes de iniciar outra publicação.'})}});return;
      }
      job.status='RUNNING';job.leaseUntil=Date.now()+15*60_000;
      if(!(await this.prisma.auditLog.updateMany({where:{id:record.id,after:{equals:record.after as Prisma.InputJsonValue}},data:{after:json(job)}})).count)return;
      await this.run(record.id,record.userId!,job);
    }finally{this.busy=false;}
  }
  private async run(id:string,userId:string,job:any){
    let sending=false;
    try{
      const p=await this.plan(job.accountId,userId,job.input);
      if(p.c.account.id!==job.mlAccount.id||p.c.account.sellerId!==job.mlAccount.sellerId||JSON.stringify(p.c.warehouse)!==JSON.stringify(job.warehouse)||p.c.userProducts!==job.userProducts)throw new BadRequestException('A configuração do vendedor mudou. Revise a publicação novamente.');
      // Stock is checked again at execution; all reviewed commercial fields remain immutable.
      job.rows=p.rows;await this.save(id,job);let familyId:string|undefined;
      for(const row of job.rows){
        await this.market.authorizeFiscal(userId);
        row.state='SENDING';job.message='Publicando SKU '+row.sku;await this.save(id,job);
        sending=true;const created=await this.client.createItem(p.c.token,row.body);row.mlb=created.id;row.state='VERIFYING';await this.save(id,job);
        let fresh=await this.client.getItem(p.c.token,created.id);
        if(!/^MLB\d+$/.test(created.id)||String(fresh.seller_id)!==job.mlAccount.sellerId)throw new Error('Não foi possível confirmar a identidade do anúncio criado.');
        if(job.userProducts){
          const up=await this.client.getUserProduct(p.c.token,fresh.user_product_id!);
          const family=await this.client.getUserProductFamily(p.c.token,String(up.family_id));
          if(String(up.user_id)!==job.mlAccount.sellerId||String(family.user_id)!==job.mlAccount.sellerId||family.family_name!==job.title||familyId&&familyId!==String(up.family_id))throw new Error('O Mercado Livre não confirmou o agrupamento das variações.');
          familyId=String(up.family_id);
        }
        if(job.warehouse){
          const current=await this.client.getProductStock(p.c.token,fresh.user_product_id!);
          if(current){
            if(String(current.data.user_id)!==job.mlAccount.sellerId)throw new Error('O depósito não pertence ao vendedor.');
            const locations=current.data.locations.filter((l:any)=>l.type==='seller_warehouse').map((l:any)=>({store_id:String(l.store_id),network_node_id:String(l.network_node_id),quantity:l.quantity}));
            const location=locations.find((l:any)=>l.store_id===job.warehouse.store_id&&l.network_node_id===job.warehouse.network_node_id);
            if(location)location.quantity=row.stock;else locations.push({...job.warehouse,quantity:row.stock});
            await this.client.updateWarehouseStock(p.c.token,fresh.user_product_id!,locations,current.version);
          }else await this.client.initializeWarehouseStock(p.c.token,fresh.user_product_id!,{...job.warehouse,quantity:row.stock});
          const checked=await this.client.getProductStock(p.c.token,fresh.user_product_id!);
          if(!checked?.data.locations.some((l:any)=>String(l.store_id)===job.warehouse.store_id&&String(l.network_node_id)===job.warehouse.network_node_id&&l.quantity===row.stock))throw new Error('O estoque do depósito não foi confirmado.');
        }
        if(job.input.description)await this.client.setDescription(p.c.token,created.id,job.input.description,false);
        fresh=await this.client.getItem(p.c.token,created.id);
        const actualPictures=fresh.pictures??[];
        if(fresh.price!==row.body.price||fresh.category_id!==row.body.category_id||fresh.currency_id!=='BRL'||fresh.listing_type_id!==row.body.listing_type_id||fresh.condition!==row.body.condition||!copyAttributesMatch(fresh.attributes,row.body.attributes)||actualPictures.length!==row.body.pictures.length||row.body.pictures.some((picture:any,index:number)=>picture.id&&actualPictures[index]?.id!==picture.id)||(fresh.shipping as any)?.free_shipping!==row.body.shipping.free_shipping||!job.userProducts&&fresh.title!==job.title)throw new Error('Os dados publicados divergem da revisão. Confira o anúncio criado.');
        if(!row.body.variations&&(sellerSku(fresh)!==row.sku||!job.warehouse&&fresh.available_quantity!==row.stock))throw new Error('O SKU ou estoque publicado não foi confirmado.');
        if(row.body.variations&&(fresh.variations?.length!==row.body.variations.length||row.body.variations.some((wanted:any)=>{const actual=fresh.variations?.find(v=>sellerSku(v)===sellerSku(wanted));return !actual||actual.price!==wanted.price||actual.available_quantity!==wanted.available_quantity||!copyAttributesMatch(actual.attribute_combinations as any[],wanted.attribute_combinations)||!copyAttributesMatch(actual.attributes as any[],wanted.attributes);})))throw new Error('As variações publicadas não correspondem à Bling.');
        for(const wanted of row.body.variations??[]){
          const actual=fresh.variations?.find(v=>sellerSku(v)===sellerSku(wanted));
          const expected=wanted.picture_ids.map((reference:string)=>/^https:\/\//i.test(reference)?actualPictures[row.body.pictures.findIndex((p:any)=>p.source===reference)]?.id:reference);
          if(expected.some((id:any)=>!id)||JSON.stringify(actual?.picture_ids)!==JSON.stringify(expected))throw new Error('As fotos da variação não foram confirmadas na ordem aprovada.');
        }
        if(job.input.description&&(await this.client.getDescription(p.c.token,created.id))?.plain_text!==job.input.description)throw new Error('A descrição não foi confirmada.');
        const wantedStatus=row.stock>0?'active':'paused';
        fresh=await confirmPublicationStatus(this.client,p.c.token,created.id,wantedStatus);
        if(fresh.status!==wantedStatus)throw new Error('O status final não foi confirmado pelo Mercado Livre.');
        await this.market.saveLocal(p.c.account,fresh);
        const local=await this.prisma.marketplaceListing.findUnique({where:{marketplaceAccountId_itemId:{marketplaceAccountId:job.mlAccount.id,itemId:fresh.id}}});
        if(!local)throw new Error('Não foi possível salvar o anúncio no sistema.');
        for(const offer of fresh.variations?.length?fresh.variations:[fresh]){
          const sku=sellerSku(offer),catalog=sku?await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:job.accountId,sku}}}):null;
          if(!catalog)throw new Error('Não foi possível confirmar o vínculo com a Bling.');
          const child=fresh.variations?.length?await this.prisma.marketplaceListingVariant.findUnique({where:{listingId_variationId:{listingId:local.id,variationId:String(offer.id)}}}):null;
          const data={listingId:local.id,listingVariantId:child?.id??null,productId:catalog.productId,productVariantId:catalog.id,matchType:'SKU' as const,confidence:100};
          if(!await this.prisma.listingProductLink.findFirst({where:{listingId:local.id,listingVariantId:data.listingVariantId,productVariantId:catalog.id}}))await this.prisma.listingProductLink.create({data});
        }
        row.state='SUCCESS';row.message='Anúncio criado, conferido e vinculado à Bling.';sending=false;await this.save(id,job);
      }
      job.status='COMPLETE';job.message='Publicação concluída. Todos os anúncios foram conferidos e vinculados à Bling.';await this.save(id,job);
    }catch(error){
      const row=job.rows.find((r:any)=>['SENDING','VERIFYING'].includes(r.state));if(row){row.state=sending?'UNVERIFIED':'FAILED';row.message=duplicationError(error);}
      job.status=sending?'NEEDS_REVIEW':job.rows.some((r:any)=>r.mlb)?'PARTIAL':'FAILED';job.message=duplicationError(error);await this.save(id,job);
    }
  }
}
