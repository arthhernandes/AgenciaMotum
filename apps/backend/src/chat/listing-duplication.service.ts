import { assertListingWritable, listingWriteBlock } from '../listings/listing-write-block';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreClient } from '../mercadolivre/mercadolivre.client';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';
import { BlingSyncService } from '../bling/synchronization/bling-sync.service';
import { ListingEditorService, editorVersion } from './listing-editor.service';
import { ChatMarketplaceService } from './chat-marketplace.service';
import { ChatPendingActionsService } from './chat-pending-actions.service';
import { ListingDuplicationTitlesService } from './listing-duplication-titles.service';
import { DuplicationPrepareDto } from './listing-duplication.dto';
import { copyAttributesMatch, copyItemBody, duplicationError, duplicationTitles, duplicationWarnings, titleKey } from './listing-duplication-model';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';
import { sameSize } from '../listing-links/sku-correspondence';
import { listingTitleBrandProblem } from './listing-title-diversity';
import { skuListingDimensions } from '../listing-links/sku-listing-dimensions';
import { applyCopiedDuplicationCharts, duplicationChartPlans, verifyCopiedDuplicationChart } from './listing-duplication-charts';
import { confirmPublicationStatus } from './listing-publication-status';
import { duplicationVariantOptions, selectDuplicationVariants } from './listing-duplication-variants';

const ACTION='LISTING_DUPLICATION_JOB';
const json=(value:any)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
@Injectable()
export class ListingDuplicationService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;private busy=false;
  constructor(private readonly prisma:PrismaService,private readonly client:MercadoLivreClient,private readonly auth:MercadoLivreAuthService,private readonly bling:BlingSyncService,private readonly editor:ListingEditorService,private readonly market:ChatMarketplaceService,private readonly pending:ChatPendingActionsService,private readonly ai:ListingDuplicationTitlesService){}
  onModuleInit(){this.timer=setInterval(()=>void this.tick().catch(()=>undefined),5000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async destinations(userId:string){
    await this.market.authorizeFiscal(userId);
    const businesses=await this.prisma.marketplaceAccount.findMany({where:{marketplace:'BLING',active:true},orderBy:{createdAt:'asc'},select:{id:true,businessKey:true,sellerId:true,name:true}});
    const sellers=await this.prisma.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',active:true,OR:[{accessToken:{not:null}},{refreshToken:{not:null}}]},select:{businessKey:true,sellerId:true}});
    const seen=new Set<string>();
    return businesses.filter(b=>!seen.has(b.businessKey)&&sellers.filter(s=>s.businessKey===b.businessKey&&s.sellerId).length===1&&(seen.add(b.businessKey),true)).map(b=>({id:b.id,name:b.name}));
  }
  private destination(context:any){return context.destination??{business:context.business,...context.source};}
  private destinationName(context:any){const destination=this.destination(context);return destination.account.name??destination.business.id;}
  private async context(accountId:string,userId:string,reference:string,destinationAccountId?:string){
    await this.market.authorizeFiscal(userId);
    const business=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:'BLING',active:true},select:{id:true,businessKey:true}});
    if(!business)throw new BadRequestException('Selecione uma conta Bling válida.');
    if(!/^MLB\d+$/.test(reference??''))throw new BadRequestException('Informe um anúncio válido.');
    const source=await this.market.chartSource(business,reference),view=await this.editor.read(accountId,reference);
    let destination={business,account:source.account,token:source.token};
    if(destinationAccountId&&destinationAccountId!==accountId){
      const target=await this.prisma.marketplaceAccount.findFirst({where:{id:destinationAccountId,marketplace:'BLING',active:true},select:{id:true,businessKey:true}});
      if(!target)throw new BadRequestException('Selecione uma loja de destino ativa.');
      const sellers=await this.prisma.marketplaceAccount.findMany({where:{businessKey:target.businessKey,marketplace:'MERCADO_LIVRE',active:true,OR:[{accessToken:{not:null}},{refreshToken:{not:null}}]},select:{id:true,name:true,sellerId:true}});
      if(sellers.length!==1||!sellers[0].sellerId)throw new BadRequestException('Conecte uma única conta Mercado Livre no destino selecionado.');
      const token=await this.auth.getValidAccessToken(sellers[0].id),owner=await this.client.getAuthenticatedSeller(token);
      if(String(owner.id)!==sellers[0].sellerId)throw new BadRequestException('A conexão do destino não corresponde ao vendedor esperado. Reconecte a conta.');
      destination={business:target,account:{...sellers[0],sellerId:sellers[0].sellerId},token};
    }
    const responses=await this.client.getItems(source.token,view.offers.map((offer:any)=>offer.reference));
    if(responses.length!==view.offers.length||responses.some(r=>r.code!==200||String(r.body.seller_id)!==source.account.sellerId))throw new BadRequestException('Não foi possível conferir todos os anúncios deste vendedor.');
    const items=responses.map(r=>r.body as any).sort((a,b)=>a.id.localeCompare(b.id));
    for(const item of items)if(!listingWriteBlock(item))await assertListingWritable(this.prisma,source.account.id,item);
    const seller=await this.client.getSeller(destination.token,destination.account.sellerId);
    const crossAccount=destination.account.id!==source.account.id;
    const userProducts=!!seller.tags?.includes('user_product_seller')||!crossAccount&&!!source.item.user_product_id;
    const warehouse=!!seller.tags?.includes('warehouse_management');
    let location:{store_id:string;network_node_id:string}|undefined;
    if(warehouse){const stores=(await this.client.getWarehouses(destination.token,destination.account.sellerId)).filter((s:any)=>s.status==='active'&&String(s.user_id)===destination.account.sellerId);if(stores.length!==1||!stores[0].network_node_id)throw new BadRequestException('A duplicação precisa de um único depósito ativo identificado para o vendedor de destino.');location={store_id:String(stores[0].id),network_node_id:String(stores[0].network_node_id)};}
    const definitions=new Map<string,any>();let maxTitleLength=60;
    const rows=[];const excluded:any[]=[];
    for(const item of items){
      if(!['active','paused'].includes(item.status)||listingWriteBlock(item)){
        const label=({under_review:'Em análise pelo Mercado Livre',closed:'Encerrado',inactive:'Inativo'} as any)[item.status]||item.status;
        excluded.push({reference:item.id,sku:sellerSku(item),...skuListingDimensions(item),status:item.status,message:label+'. Esta oferta não será copiada; corrija a situação do anúncio original para disponibilizá-la.'});
        continue;
      }
      if(!definitions.has(item.category_id))definitions.set(item.category_id,await this.client.category(destination.token,item.category_id));
      const category=definitions.get(item.category_id);
      maxTitleLength=Math.min(maxTitleLength,category.category?.settings?.max_title_length??60);
      const readOnly=category.attributes.filter((a:any)=>a.tags?.read_only).map((a:any)=>a.id).filter((id:string)=>id!=='SELLER_SKU');
      const description=(await this.client.getDescription(source.token,item.id))?.plain_text??'';
      if(crossAccount&&userProducts&&item.variations?.some((variation:any)=>!sellerSku(variation)))throw new BadRequestException('Vincule os SKUs de todas as variações do modelo antes de copiar para outra conta.');
      const models=crossAccount&&userProducts&&item.variations?.length?item.variations.map((variation:any)=>({...item,variations:[],price:variation.price??item.price,attributes:[...new Map<string,any>([...(item.attributes??[]),...(variation.attribute_combinations??[]),...(variation.attributes??[]),{id:'SELLER_SKU',value_name:sellerSku(variation)}].map(a=>[a.id,a])).values()],pictures:variation.picture_ids?.length?item.pictures.filter((p:any)=>variation.picture_ids.includes(p.id)):item.pictures,available_quantity:variation.available_quantity,sourceVariationId:String(variation.id)})):[item];
      for(const model of models){
        const body=copyItemBody(model,view.title,userProducts,warehouse,readOnly);
        if(crossAccount){delete body.official_store_id;delete body.channels;if(body.shipping)body.shipping=Object.fromEntries(['mode','free_shipping','local_pick_up','dimensions'].filter(key=>body.shipping[key]!=null).map(key=>[key,body.shipping[key]]));}
        if(warehouse&&body.variations)throw new BadRequestException('Conclua a migração das variações tradicionais para User Products antes de duplicar com estoque por depósito.');
        rows.push({reference:item.id,sourceVariationId:model.sourceVariationId??null,body,description,stock:undefined as number|undefined,status:item.status,sku:sellerSku(model),variations:model.variations??[],sourceFamilyId:view.familyId});
      }
    }
    if(!rows.length)throw new BadRequestException('Nenhuma oferta deste anúncio está ativa ou pausada para duplicação. '+excluded.map(row=>row.reference+': '+row.message).join(' '));
    if(crossAccount&&!userProducts&&rows.length>1)throw new BadRequestException('A conta de destino ainda usa anúncios tradicionais. Conclua a migração para User Products para copiar esta família completa.');
    const charts=await duplicationChartPlans(this.client,source.token,source.account.sellerId,destination.account.sellerId,rows,view.title);
    const version=editorVersion({viewVersion:view.version,rows,destination:{businessId:destination.business.id,accountId:destination.account.id,sellerId:destination.account.sellerId,userProducts,warehouse:location},charts});
    return {business,source,destination,view,rows,excluded,charts,version,maxTitleLength,userProducts,warehouse:location};
  }
  async titles(accountId:string,userId:string,reference:string,count:number,destinationAccountId?:string,manual=false){
    if(!Number.isInteger(count)||count<1||count>10)throw new BadRequestException('Escolha de 1 a 10 cópias.');
    const context=await this.context(accountId,userId,reference,destinationAccountId);
    if(count*context.rows.length>500)throw new BadRequestException('Escolha menos cópias: cada operação permite até 500 ofertas, somando as variações.');
    const facts=this.titleFacts(context);
    return {reference,version:context.version,destinationAccountId:this.destination(context).business.id,destinationName:this.destinationName(context),originalTitle:context.view.title,maxTitleLength:context.maxTitleLength,offersPerCopy:context.rows.length,variants:duplicationVariantOptions(context.rows),excluded:context.excluded??[],titles:manual?Array.from({length:count},()=>''):await this.ai.generate(context.view.title,count,context.maxTitleLength,facts)};
  }
  private titleFacts(context:any){
    const allowed=new Set(['BRAND','MODEL','GENDER','MAIN_MATERIAL','COMPOSITION','FABRIC_TYPE','NECK_TYPE','SLEEVE_LENGTH','CLOTHING_LENGTH','FIT','PATTERN','FABRIC_DESIGN','AGE_GROUP','STYLE']);
    const attributes=[...(context.view.attributes??[]),...(context.source.item?.attributes??[]).filter((a:any)=>a.id==='BRAND').map((a:any)=>({id:a.id,name:'Marca',value:a.value_name||a.values?.[0]?.name||''}))];
    const facts=new Map<string,{name:string;value:string}>();
    for(const attribute of attributes)if(allowed.has(attribute.id)&&attribute.value?.trim())facts.set(attribute.id,{name:attribute.name||attribute.id,value:attribute.value});
    return [...facts.values()];
  }
  private assertUnbranded(titles:string[],context:any){
    const facts=this.titleFacts(context);
    for(const title of titles){const problem=listingTitleBrandProblem(title,context.view.title,facts);if(problem)throw new BadRequestException(problem);}
  }
  private async assertNewNames(accountId:string,titles:string[],createdIds:string[]=[]){
    const existing=await this.prisma.marketplaceListing.findMany({where:{marketplaceAccountId:accountId,...(createdIds.length?{itemId:{notIn:createdIds}}:{})},select:{title:true,rawData:true}});
    const names=new Set(existing.map(row=>titleKey((row.rawData as any)?.family_name||row.title)));
    if(titles.some(title=>names.has(titleKey(title))))throw new BadRequestException('Um título já está em uso nesta conta. Altere-o para criar uma família separada.');
  }
  private assertSize(catalog:any,attributes:any[]){const size=skuListingDimensions({attributes}).size;if(catalog.size&&(!size||!sameSize(size,catalog.size)))throw new BadRequestException('O tamanho do SKU '+catalog.sku+' diverge da Bling de destino. Corrija o vínculo antes de duplicar.');}
  private async catalogVariant(accountId:string,sku:string){
    const local=await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:accountId,sku}}});
    if(local)return local;
    return null;
  }
  private async stocks(accountId:string,row:any,warehouse:boolean){
    if(row.body.variations){
      for(let i=0;i<row.variations.length;i++){
        const sku=sellerSku(row.variations[i]);if(!sku)throw new BadRequestException('Vincule os SKUs de todas as variações antes de duplicar.');
        const catalog=await this.catalogVariant(accountId,sku);
        if(!catalog)throw new BadRequestException(`O SKU ${sku} não foi encontrado na Bling desta conta.`);
        this.assertSize(catalog,[...(row.variations[i].attribute_combinations??[]),...(row.variations[i].attributes??[])]);
        row.body.variations[i].available_quantity=(await this.bling.liveStockForSku(accountId,sku)).publishable;
      }
    }else{
      if(!row.sku)throw new BadRequestException(`Vincule o SKU do anúncio ${row.reference} antes de duplicar.`);
      const catalog=await this.catalogVariant(accountId,row.sku);
      if(!catalog)throw new BadRequestException(`O SKU ${row.sku} não foi encontrado na Bling desta conta.`);
      this.assertSize(catalog,row.body.attributes);
      const stock=await this.bling.liveStockForSku(accountId,row.sku);row.stock=stock.publishable;row.body.available_quantity=warehouse?0:stock.publishable;
    }
    const quantity=row.body.variations?row.body.variations.reduce((sum:number,v:any)=>sum+v.available_quantity,0):row.stock??row.body.available_quantity;
    row.body.status=row.status==='paused'||quantity===0?'paused':'active';
  }
  private async validate(token:string,body:any){
    try{await this.client.validateItem(token,body);return [] as string[];}
    catch(error){const warnings=duplicationWarnings(error);if(warnings)return warnings;throw new BadRequestException(duplicationError(error));}
  }
  async prepare(accountId:string,userId:string,input:DuplicationPrepareDto){
    const context=await this.context(accountId,userId,input.reference,input.destinationAccountId),destination=this.destination(context);
    if(input.version!==context.version)throw new ConflictException('O anúncio original mudou. Gere os títulos novamente para atualizar os dados.');
    const titles=duplicationTitles(input.titles,context.view.title,context.maxTitleLength);
    this.assertUnbranded(titles,context);
    const selectedRows=selectDuplicationVariants(context.rows,input.variants);
    if(titles.length*selectedRows.length>500)throw new BadRequestException('Esta operação ultrapassa o limite de 500 ofertas. Reduza as cópias.');
    await this.assertNewNames(destination.account.id,titles);
    for(const row of selectedRows)await this.stocks(destination.business.id,row,!!context.warehouse);
    const rows=titles.flatMap((title,copy)=>selectedRows.map(source=>({...structuredClone(source),copy,title,body:{...structuredClone(source.body),[context.userProducts?'family_name':'title']:title},state:'PENDING',mlb:null,message:'',deferredChartValidation:false})));
    const warnings=new Set<string>();
    for(const row of rows){const attributes=[...(row.body.attributes??[]),...(row.body.variations??[]).flatMap((v:any)=>v.attributes??[])];row.deferredChartValidation=(context.charts??[]).some((chart:any)=>attributes.some((a:any)=>a.id==='SIZE_GRID_ID'&&String(a.value_name??a.values?.[0]?.name??'')===chart.sourceId));if(!row.deferredChartValidation)for(const warning of await this.validate(destination.token,row.body))warnings.add(warning);}
    if(context.charts?.length)warnings.add('As tabelas de medidas particulares serão copiadas para a conta de destino após a confirmação. As ofertas serão validadas com essas tabelas antes de publicar.');
    const id=randomUUID();
    await this.pending.save({id,accountId,userId,destinationAccountId:destination.business.id,destinationName:this.destinationName(context),purpose:'LISTING_DUPLICATION',reference:input.reference,version:context.version,titles,rows,charts:context.charts??[],warehouse:context.warehouse??null,sourceFamilyId:context.view.familyId,mlAccount:{id:destination.account.id,sellerId:destination.account.sellerId,businessKey:destination.business.businessKey},expiresAt:Date.now()+15*60_000});
    return {id,titles,destinationAccountId:destination.business.id,destinationName:destination.account.name,copies:titles.length,offersPerCopy:selectedRows.length,totalOffers:rows.length,originalTitle:context.view.title,warnings:[...warnings],rows:rows.map(row=>({copy:row.copy,title:row.title,reference:row.reference,sku:row.sku,variants:duplicationVariantOptions([row]),price:row.body.price,stock:row.stock??row.body.variations?.reduce((sum:number,v:any)=>sum+v.available_quantity,0)??row.body.available_quantity,status:row.status}))};
  }
  async confirm(accountId:string,userId:string,id:string){
    await this.market.authorizeFiscal(userId);
    const previous=await this.prisma.auditLog.findFirst({where:{id:'duplication:'+id,action:ACTION,entityId:accountId,userId}});
    if(previous)return {jobId:previous.id};
    const saved=await this.pending.load(id,accountId,userId);
    if(saved?.purpose!=='LISTING_DUPLICATION'||saved.expiresAt<Date.now())throw new NotFoundException('A revisão expirou. Prepare novamente.');
    const context=await this.context(accountId,userId,saved.reference,saved.destinationAccountId);
    if(context.version!==saved.version)throw new ConflictException('O anúncio mudou depois da revisão. Prepare novamente.');
    if(this.destination(context).account.id!==saved.mlAccount.id||this.destination(context).account.sellerId!==saved.mlAccount.sellerId)throw new ConflictException('O vendedor de destino mudou. Prepare outra revisão.');
    this.assertUnbranded(saved.titles,context);
    await this.assertNewNames(saved.mlAccount.id,saved.titles);
    const jobId='duplication:'+id;
    await this.prisma.$transaction(async tx=>{
      const claimed=await tx.auditLog.updateMany({where:{id,action:'CHAT_PENDING_ACTION',entityType:'PendingChatAction',entityId:accountId,userId,after:{path:['status'],equals:'PENDING'}},data:{after:json({status:'CLAIMED',payload:saved})}});
      if(claimed.count!==1)throw new ConflictException('Esta duplicação já foi confirmada. Atualize o acompanhamento.');
      await tx.auditLog.create({data:{id:jobId,action:ACTION,entityType:'ListingDuplication',entityId:accountId,userId,after:json({...saved,status:'QUEUED',message:'Duplicação confirmada. Aguardando processamento.'})}});
    });
    return {jobId};
  }
  async latest(accountId:string,userId:string,reference:string,destinationAccountId?:string){
    if(!/^MLB\d+$/.test(reference??''))throw new BadRequestException('Informe um anúncio válido.');
    const record=await this.prisma.auditLog.findFirst({where:{action:ACTION,entityId:accountId,userId,AND:[{OR:[{after:{path:['reference'],equals:reference}},{after:{path:['rows'],array_contains:[{reference}]}}]},...(destinationAccountId?[{after:{path:['destinationAccountId'],equals:destinationAccountId}}]:[])]},orderBy:{createdAt:'desc'}});
    return record?this.status(accountId,userId,record.id):null;
  }
  private resumable(job:any){
    return ['NEEDS_REVIEW','PARTIAL'].includes(job.status)&&job.rows.some((r:any)=>r.state==='PENDING'&&!r.mlb)&&job.rows.every((r:any)=>r.state==='PENDING'&&!r.mlb||/^MLB\d+$/.test(r.mlb??''))&&(job.charts??[]).every((c:any)=>c.state==='SUCCESS');
  }
  async resume(accountId:string,userId:string,id:string){
    await this.market.authorizeFiscal(userId);
    const record=await this.prisma.auditLog.findFirst({where:{id,action:ACTION,entityId:accountId,userId}});
    if(!record)throw new NotFoundException('Duplicação não encontrada nesta conta.');
    const job=structuredClone(record.after) as any;
    if(['QUEUED','RUNNING'].includes(job.status))return {jobId:id};
    if(!this.resumable(job))throw new ConflictException('Esta operação precisa de conferência manual antes de continuar. Nenhum anúncio será recriado.');
    const context=await this.context(accountId,userId,job.reference,job.destinationAccountId);
    if(context.version!==job.version||this.destination(context).account.id!==job.mlAccount.id||this.destination(context).account.sellerId!==job.mlAccount.sellerId)throw new ConflictException('O modelo ou a conta mudou. Confira as ofertas já criadas antes de continuar.');
    job.status='QUEUED';job.message='Retomada confirmada. As ofertas existentes serão conferidas antes de continuar.';
    for(const row of job.rows)if(row.state!=='SUCCESS'){
      row.state=row.mlb?'VERIFYING':'PENDING';row.message=row.mlb?'Aguardando nova conferência.':'';
    }
    const claimed=await this.prisma.auditLog.updateMany({where:{id,action:ACTION,entityId:accountId,userId,after:{equals:record.after as Prisma.InputJsonValue}},data:{after:json(job)}});
    if(!claimed.count)throw new ConflictException('A operação mudou. Atualize o acompanhamento.');
    return {jobId:id};
  }
  async status(accountId:string,userId:string,id:string){
    const record=await this.prisma.auditLog.findFirst({where:{id,action:ACTION,entityId:accountId,userId}});
    if(!record)throw new NotFoundException('Duplicação não encontrada nesta conta.');
    const job=record.after as any;
    return {jobId:id,status:job.status,canResume:this.resumable(job),destinationAccountId:job.destinationAccountId??accountId,destinationName:job.destinationName??'',message:job.message,charts:(job.charts??[]).map((chart:any)=>({id:chart.id,state:chart.state})),total:job.rows.length,completed:job.rows.filter((r:any)=>r.state==='SUCCESS').length,created:job.rows.filter((r:any)=>r.mlb).length,copies:job.titles.length,rows:job.rows.map((r:any)=>({copy:r.copy,title:r.title,reference:r.reference,sku:r.sku,variants:duplicationVariantOptions([r]),mlb:r.mlb,state:r.state,message:r.message}))};
  }
  private save(id:string,job:any){job.leaseUntil=Date.now()+15*60_000;return this.prisma.auditLog.update({where:{id},data:{after:json(job)}});}
  async tick(){
    if(this.busy)return;this.busy=true;
    try{
      const record=await this.prisma.auditLog.findFirst({where:{action:ACTION,OR:[{after:{path:['status'],equals:'QUEUED'}},{after:{path:['status'],equals:'RUNNING'}}]},orderBy:{createdAt:'asc'}});
      if(!record)return;const job=structuredClone(record.after) as any;
      if(job.status==='RUNNING'){
        if(job.leaseUntil>Date.now())return;
        const after={...job,status:'NEEDS_REVIEW',message:'O processamento foi interrompido. Confira os anúncios já criados antes de preparar outra duplicação.'};
        await this.prisma.auditLog.updateMany({where:{id:record.id,after:{equals:record.after as Prisma.InputJsonValue}},data:{after:json(after)}});return;
      }
      job.status='RUNNING';job.leaseUntil=Date.now()+15*60_000;
      const claimed=await this.prisma.auditLog.updateMany({where:{id:record.id,after:{equals:record.after as Prisma.InputJsonValue}},data:{after:json(job)}});
      if(!claimed.count)return;
      await this.run(record.id,record.userId!,job);
    }finally{this.busy=false;}
  }
  private async run(id:string,userId:string,job:any){
    let sending=false;
    try{
      const context=await this.context(job.accountId,userId,job.reference,job.destinationAccountId),destination=this.destination(context);
      if(context.version!==job.version)throw new BadRequestException('O modelo mudou antes da publicação. Prepare uma nova duplicação.');
      this.assertUnbranded(job.titles,context);
      if(destination.account.id!==job.mlAccount.id||destination.account.sellerId!==job.mlAccount.sellerId)throw new BadRequestException('A conta do vendedor de destino mudou.');
      await this.assertNewNames(job.mlAccount.id,job.titles,job.rows.map((r:any)=>r.mlb).filter(Boolean));
      const token=await this.auth.getValidAccessToken(job.mlAccount.id),families=new Map<number,string>();
      // Recheck the entire approved batch before the first publication.
      for(const row of job.rows){await this.stocks(job.destinationAccountId??job.accountId,row,!!job.warehouse);if(!row.deferredChartValidation)await this.validate(token,row.body);}
      for(const chart of job.charts??[]){
        if(chart.state==='SUCCESS')continue;
        await this.market.authorizeFiscal(userId);
        chart.state='SENDING';job.message='Copiando tabela de medidas para a conta de destino.';await this.save(id,job);sending=true;
        const created=await this.client.createSizeChart(token,chart.name,chart.body);chart.id=String(created.id);chart.state='VERIFYING';await this.save(id,job);
        const fresh=await this.client.getSizeChart(token,chart.id);chart.rowIds=verifyCopiedDuplicationChart(chart,fresh,job.mlAccount.sellerId);chart.state='SUCCESS';sending=false;await this.save(id,job);
      }
      for(const row of job.rows)if(row.deferredChartValidation){applyCopiedDuplicationCharts(row.body,job.charts);await this.validate(token,row.body);}
      for(const row of job.rows){
        await this.market.authorizeFiscal(userId);
        await this.stocks(job.destinationAccountId??job.accountId,row,!!job.warehouse);
        let created:{id:string};
        if(row.mlb){created={id:row.mlb};row.state='VERIFYING';row.message='Conferindo os dados da oferta existente.';job.message='Conferindo oferta já criada '+row.mlb+'.';await this.save(id,job);}
        else{row.state='SENDING';job.message=`Publicando cópia ${row.copy+1} de ${job.titles.length}.`;await this.save(id,job);
          sending=true;created=await this.client.createItem(token,row.body);row.mlb=created.id;row.state='VERIFYING';await this.save(id,job);}
        if(!/^MLB\d+$/.test(created.id)||job.rows.some((r:any)=>r.reference===created.id))throw new Error('Invalid new item identity');
        let fresh=await this.client.getItem(token,created.id);
        if(String(fresh.seller_id)!==job.mlAccount.sellerId)throw new Error('Owner mismatch');
        if(context.userProducts){
          if(!fresh.user_product_id)throw new Error('Missing user product');
          const up=await this.client.getUserProduct(token,fresh.user_product_id),family=String(up.family_id);
          if(String(up.user_id)!==job.mlAccount.sellerId||family===String(job.sourceFamilyId)||families.has(row.copy)&&families.get(row.copy)!==family||[...families].some(([copy,value])=>copy!==row.copy&&value===family))throw new Error('Copy family mismatch');
          const familyData=await this.client.getUserProductFamily(token,family);
          if(String(familyData.user_id)!==job.mlAccount.sellerId||familyData.family_name!==row.title)throw new Error('Copy title mismatch');
          families.set(row.copy,family);
        }
        if(job.warehouse){
          const stock=await this.client.getProductStock(token,fresh.user_product_id!);
          if(stock){if(String(stock.data.user_id)!==job.mlAccount.sellerId)throw new Error('Stock owner mismatch');const locations=stock.data.locations.filter((l:any)=>l.type==='seller_warehouse').map((l:any)=>({store_id:String(l.store_id),network_node_id:String(l.network_node_id),quantity:l.quantity}));const location=locations.find((l:any)=>l.store_id===job.warehouse.store_id&&l.network_node_id===job.warehouse.network_node_id);if(location)location.quantity=row.stock;else locations.push({...job.warehouse,quantity:row.stock});await this.client.updateWarehouseStock(token,fresh.user_product_id!,locations,stock.version);}
          else await this.client.initializeWarehouseStock(token,fresh.user_product_id!,{...job.warehouse,quantity:row.stock});
          const verified=await this.client.getProductStock(token,fresh.user_product_id!);
          if(String(verified?.data.user_id)!==job.mlAccount.sellerId||!verified?.data.locations.some((l:any)=>String(l.store_id)===job.warehouse.store_id&&String(l.network_node_id)===job.warehouse.network_node_id&&l.quantity===row.stock))throw new Error('Stock not verified');
        }
        if(row.description){
          const description=await this.client.getDescription(token,created.id);
          if(description?.plain_text!==row.description)await this.client.setDescription(token,created.id,row.description,!!description);
        }
        const quantity=row.body.variations?row.body.variations.reduce((sum:number,v:any)=>sum+v.available_quantity,0):row.stock??row.body.available_quantity;
        const wantedStatus=row.status==='paused'||quantity===0?'paused':'active';
        fresh=await confirmPublicationStatus(this.client,token,created.id,wantedStatus);
        await this.market.saveLocal(destination.account,fresh);
        if(fresh.price!==row.body.price||fresh.category_id!==row.body.category_id||fresh.currency_id!==row.body.currency_id||fresh.listing_type_id!==row.body.listing_type_id||fresh.status!==wantedStatus||row.sku&&sellerSku(fresh)!==row.sku||JSON.stringify(fresh.pictures?.map(p=>p.id))!==JSON.stringify(row.body.pictures.map((p:any)=>p.id))||!copyAttributesMatch(fresh.attributes,row.body.attributes)||!copyAttributesMatch(fresh.sale_terms,row.body.sale_terms))throw new Error('Publication readback incomplete');
        if(!context.userProducts&&fresh.title!==row.title)throw new Error('Copy title mismatch');
        if(row.body.variations){if(fresh.variations?.length!==row.body.variations.length||row.body.variations.some((wanted:any)=>{const actual=fresh.variations?.find(v=>sellerSku(v)===sellerSku(wanted));return !actual||actual.price!==wanted.price||actual.available_quantity!==wanted.available_quantity||!copyAttributesMatch(actual.attribute_combinations as any[],wanted.attribute_combinations)||!copyAttributesMatch(actual.attributes as any[],wanted.attributes)||JSON.stringify(actual.picture_ids)!==JSON.stringify(wanted.picture_ids);}))throw new Error('Variation readback incomplete');}
        if(row.description&&(await this.client.getDescription(token,created.id))?.plain_text!==row.description)throw new Error('Description readback incomplete');
        const local=await this.prisma.marketplaceListing.findUnique({where:{marketplaceAccountId_itemId:{marketplaceAccountId:job.mlAccount.id,itemId:fresh.id}}});
        if(local){
          const variants=fresh.variations?.length?fresh.variations:[fresh];
          for(const item of variants){const sku=sellerSku(item);if(!sku)continue;const variant=await this.catalogVariant(job.destinationAccountId??job.accountId,sku);if(!variant)continue;
            const listingVariant=fresh.variations?.length?await this.prisma.marketplaceListingVariant.findUnique({where:{listingId_variationId:{listingId:local.id,variationId:String(item.id)}}}):null;
            const data={listingId:local.id,listingVariantId:listingVariant?.id??null,productId:variant.productId,productVariantId:variant.id,matchType:'SKU' as const,confidence:100};
            if(!await this.prisma.listingProductLink.findFirst({where:{listingId:local.id,listingVariantId:data.listingVariantId,productVariantId:variant.id}}))await this.prisma.listingProductLink.create({data});
          }
        }
        row.state='SUCCESS';row.message='Anúncio criado e conferido.';sending=false;await this.save(id,job);
      }
      job.status='COMPLETE';job.message='Todas as cópias foram publicadas e conferidas.';await this.save(id,job);
    }catch(error){
      const row=job.rows.find((r:any)=>r.state==='SENDING'||r.state==='VERIFYING');if(row){row.state=sending?'UNVERIFIED':'FAILED';row.message=duplicationError(error);}
      job.status=sending?'NEEDS_REVIEW':job.rows.some((r:any)=>r.mlb)?'PARTIAL':'FAILED';job.message=duplicationError(error);await this.save(id,job);
    }
  }
}
