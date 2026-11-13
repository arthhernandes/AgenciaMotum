import { VARIATION_BATCH_SIZE, publicationBatchIndices } from './variation-batches';
import { assertListingWritable, FINALIZED_MESSAGE } from '../listings/listing-write-block';
import { effectivePermissions } from '../auth/permissions';
import { variantSizeValue } from './variant-size-value';
import { sizeChartPolicy } from './size-chart-policy';
import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';
import { MercadoLivreClient } from '../mercadolivre/mercadolivre.client';
import { BlingSyncService } from '../bling/synchronization/bling-sync.service';
import { ChatFamilyVariants } from './chat-family-variants';
import {editorVersion} from './listing-editor.service';
import { variantColorName } from './variant-color-name';
import { matchesCatalogVariant } from './catalog-variant-match';
import { ChatSizeCharts, checkedChartRows, createdSizeCharts } from './chat-size-charts';

export type PublicationPlan={publishWithoutStock?:boolean;sizeChart?:{id:string;name?:string;rows:Record<string,string>};publicationPolicy?:'PUBLISH_AVAILABLE';businessId:string;businessKey:string;accountId:string;sellerId:string;familyId:string;familyName?:string;modelMlb:string;price:number;warehouse:{store_id:string;network_node_id:string};offer:Record<string,any>;rows:Array<{additionalOffer?:{upId:string;existingIds:string[]};replacementOffers?:Array<{id:string;upId:string;fingerprint:string}>;publicationAttributes?:any[];sku:string;color:string;size:string;productVariantId:string;variant:Record<string,any>}>};
type PublicationRow={replacementSent?:string[];replacementClosed?:string[];publicationVerified?:boolean;verifiedPrice?:number;sku:string;status:string;message:string;upId?:string;mlb?:string;stock?:number;stockCheckedAt?:string;variantSent?:boolean;stockSent?:boolean;offerSent?:boolean};
type Job={metadataSent?:boolean;metadataTaskId?:string;status:string;plan:PublicationPlan;rows:PublicationRow[];leaseUntil?:number;nextAt?:number;updatedAt?:string;publicationPolicy?:'ALL_OR_NOTHING'|'PUBLISH_AVAILABLE';blockedReason?:string};
export const ATOMIC_PUBLICATION_REQUIRED='Publicação bloqueada pela regra todas ou nenhuma: o envio individual de ofertas não garante que o lote inteiro ficará ativo. Nenhuma nova oferta será enviada por este fluxo, nem retomada automaticamente.';
const normalize=(value:unknown)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export const replacementFingerprint=(item:any)=>editorVersion({id:item.id,seller:item.seller_id,userProduct:item.user_product_id,status:item.status,subStatus:[...(item.sub_status??[])].sort(),price:item.price,attributes:item.attributes,pictures:item.pictures});
class PublicationCancelled extends Error {}

@Injectable()
export class ChatFamilyPublicationService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private busy=false;
  constructor(private readonly prisma:PrismaService,private readonly auth:MercadoLivreAuthService,private readonly client:MercadoLivreClient,private readonly bling:BlingSyncService) {}
  onModuleInit(){this.timer=setInterval(()=>{void this.tick().catch(()=>{});},5000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}

  // The implemented provider flow creates one item per request. A successful
  // preflight cannot make those writes atomic or prevent later moderation.
  private canGuaranteeAtomicPublication(){return false;}
  private requireAtomicPublication(plan?:Pick<PublicationPlan,'publicationPolicy'>){if(plan?.publicationPolicy!=='PUBLISH_AVAILABLE'&&!this.canGuaranteeAtomicPublication())throw new BadRequestException(ATOMIC_PUBLICATION_REQUIRED);}

  async prepare(business:{id:string;businessKey:string},userId:string,args:{anuncio:string;preco:number;skus?:string[];additionalOfferSkus?:string[];replacementSkus?:string[];size_chart_id?:string;fotos_modelo_confirmadas:boolean;publicar_com_saldo?:boolean}):Promise<PublicationPlan> {
    const publicationPolicy=args.publicar_com_saldo===true?'PUBLISH_AVAILABLE':undefined;
    this.requireAtomicPublication({publicationPolicy});
    const user=await this.prisma.user.findUnique({where:{id:userId},select:{active:true,role:true,permissions:true}});
    if(!user?.active||!effectivePermissions(user).includes('listings.manage'))throw new BadRequestException('Usuário sem permissão para publicar.');
    if(!/^MLB\d+$/.test(args.anuncio))throw new BadRequestException('Informe o MLB modelo do anúncio pai.');
    if(!Number.isFinite(args.preco)||args.preco<=0||Math.abs(args.preco*100-Math.round(args.preco*100))>0.0001)throw new BadRequestException('Informe um preço válido para as novas ofertas.');
    // The preview displays inherited pictures; its confirmation authorizes use.
    const listing=await this.prisma.marketplaceListing.findFirst({where:{itemId:args.anuncio,marketplaceAccount:{businessKey:business.businessKey,marketplace:'MERCADO_LIVRE',active:true}},include:{marketplaceAccount:true}});
    if(!listing)throw new BadRequestException('O anúncio modelo não pertence à conta selecionada.');
    const account=listing.marketplaceAccount;const token=await this.auth.getValidAccessToken(account.id);
    const item=await this.client.getItem(token,args.anuncio);
    await assertListingWritable(this.prisma,account.id,item);
    if(String(item.seller_id)!==account.sellerId)throw new BadRequestException('O modelo pertence a outro vendedor.');
    const inspector=new ChatFamilyVariants(this.prisma,this.auth,this.client);
    const {family,model,products}=await inspector.inspect({account,token,item});
    const sourceSku=item.attributes?.find(a=>a.id==='SELLER_SKU')?.value_name;
    const source=await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:business.id,sku:sourceSku??''}},include:{product:true}});
    if(!source)throw new BadRequestException('O produto Bling do modelo não foi identificado.');
    const catalog=await this.prisma.productVariant.findMany({where:{productId:source.productId,blingAccountId:business.id,...(args.skus?.length?{sku:{in:args.skus}}:{})}});
    if(!catalog.length||args.skus?.length&&catalog.length!==new Set(args.skus).size)throw new BadRequestException('Um SKU solicitado não foi encontrado no produto Bling deste pai.');
    const policy=await sizeChartPolicy(this.client,token,item);
    if(args.size_chart_id&&!policy.supported)throw new BadRequestException('Esta categoria não utiliza tabela de medidas. Prepare novamente sem selecionar uma tabela.');
    const chartId=policy.supported?(args.size_chart_id??model.attributes.find((attribute:any)=>attribute.id==='SIZE_GRID_ID')?.values?.[0]?.name):undefined;
    const chartRequired=policy.required;
    if(!chartId&&chartRequired)throw new BadRequestException('Esta categoria exige tabela de medidas. Escolha ou cadastre uma tabela antes de preparar a inclusão.');
    let sizeChart:PublicationPlan['sizeChart'];
    if(args.size_chart_id){const selected=await new ChatSizeCharts(this.client,await createdSizeCharts(this.prisma,business.id,item.id)).select({account,token,item},String(chartId),catalog.map(row=>row.size??''));sizeChart={...selected,rows:Object.fromEntries(Object.entries(selected.rows).map(([size,id])=>[normalize(size),id]))};}
    else if(chartId){const chart=await this.client.getSizeChart(token,String(chartId));const checked=checkedChartRows(chart,{account,token,item},catalog.map(row=>row.size??''));sizeChart={id:String(chart.id),name:chart.names?.MLB,rows:Object.fromEntries(Object.entries(checked).map(([size,id])=>[normalize(size),id]))};}
    const packageAttributes=model.attributes.filter((attribute:any)=>/^SELLER_PACKAGE_(HEIGHT|LENGTH|WIDTH|WEIGHT|TYPE)$/.test(attribute.id)).map((attribute:any)=>({id:attribute.id,name:attribute.name,values:attribute.values.map((value:any)=>({id:value.id??null,name:value.name??null}))}));
    if(['HEIGHT','LENGTH','WIDTH','WEIGHT'].some(dimension=>!packageAttributes.some((attribute:any)=>attribute.id==='SELLER_PACKAGE_'+dimension)))throw new BadRequestException('O modelo precisa informar as quatro dimensões e peso do pacote.');
    const stores=(await this.client.getWarehouses(token,account.sellerId)).filter(s=>String(s.user_id)===account.sellerId&&s.status==='active'&&s.tags?.includes('stock_location')&&s.network_node_id);
    if(stores.length!==1)throw new BadRequestException('A publicação exige um depósito ativo identificado de forma única.');
    const warehouse={store_id:String(stores[0].id),network_node_id:String(stores[0].network_node_id)};
    const offer={price:args.preco,category_id:item.category_id,currency_id:'BRL',buying_mode:'buy_it_now',listing_type_id:item.listing_type_id,channels:['marketplace'],shipping:{mode:'me2',free_shipping:true},...(item.sale_terms?.length?{sale_terms:item.sale_terms}:{})};
    const replacements=new Map<string,NonNullable<PublicationPlan['rows'][number]['replacementOffers']>>();
    for(const sku of args.replacementSkus??[]){
      const row=catalog.find(row=>row.sku===sku);if(!row)throw new BadRequestException('SKU de substituição fora da seleção.');
      const offers:NonNullable<PublicationPlan['rows'][number]['replacementOffers']>=[];
      for(const upId of (await this.client.getFamilyUserProducts(token,String(family.family_id))).user_products_ids){
        const up=await this.client.getUserProduct(token,upId);this.owner(up,{sellerId:account.sellerId} as PublicationPlan);
        if(String(up.family_id)!==String(family.family_id)||!this.sameVariant(up,row as any))continue;
        for(const mlb of await this.client.searchUserProductOffers(token,account.sellerId,up.id)){
          const old=await this.client.getItem(token,mlb);this.owner(old,{sellerId:account.sellerId} as PublicationPlan);
          if(old.status==='closed')continue;
          const correction=await this.pendingCorrection(token,account.sellerId,old);
          if(correction)throw new BadRequestException(correction);
          if(old.status!=='under_review'||old.user_product_id!==up.id)throw new BadRequestException('A oferta mudou ou possui outra oferta publicada. Consulte novamente antes de substituir.');
          offers.push({id:old.id,upId:up.id,fingerprint:replacementFingerprint(old)});
        }
      }
      if(!offers.length)throw new BadRequestException('Não há oferta em análise confirmada para substituir neste tamanho.');
      if(new Set(offers.map(offer=>offer.upId)).size!==1)throw new BadRequestException('Há variantes duplicadas na família. Revise antes de substituir.');
      replacements.set(sku,offers);
    }
    const additionalOffers=new Map<string,{upId:string;existingIds:string[]}>();
    for(const sku of args.additionalOfferSkus??[]){
      const row=catalog.find(row=>row.sku===sku);if(!row)throw new BadRequestException('SKU fora da seleção.');
      const candidates=[];
      for(const up of products.filter(product=>this.sameVariant(product,row as any))){
        const existingIds=await this.client.searchUserProductOffers(token,account.sellerId,up.id);
        for(const mlb of existingIds){const old=await this.client.getItem(token,mlb);this.owner(old,{sellerId:account.sellerId} as PublicationPlan);if(old.user_product_id!==up.id)throw new BadRequestException('Oferta de outra variante.');if(!['under_review','inactive','closed'].includes(old.status??''))throw new BadRequestException('Já existe oferta ativa ou pausada para este tamanho. Consulte novamente.');}
        candidates.push({upId:up.id,existingIds});
      }
      if(!candidates.length)throw new BadRequestException('O cadastro existente deste tamanho mudou. Consulte novamente.');
      candidates.sort((a,b)=>a.existingIds.length-b.existingIds.length);additionalOffers.set(sku,candidates[0]);
    }
    return {publishWithoutStock:true,sizeChart,publicationPolicy,businessId:business.id,businessKey:business.businessKey,accountId:account.id,sellerId:account.sellerId,familyId:String(family.family_id),familyName:family.family_name,modelMlb:item.id,price:args.preco,warehouse,offer,
      rows:catalog.map(row=>{
        if(!row.color||!row.size)throw new BadRequestException(`O SKU ${row.sku} não possui cor e tamanho.`);
        const gridRow=sizeChart?.rows[normalize(row.size)];if(sizeChart&&!gridRow)throw new BadRequestException(`O tamanho ${row.size} não existe no guia do modelo.`);
        const attributes=family.child_attributes_ids.filter((id:string)=>sizeChart||!['SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(id)).map((id:string)=>{
          if(id==='COLOR'||id==='SIZE')return {id,values:[id==='COLOR'?{id:null,name:variantColorName(row.color!)}:variantSizeValue(row.size!,model.attributes)]};
          if(id==='SIZE_GRID_ROW_ID')return {id,values:[{id:null,name:gridRow}]};
          const inherited=model.attributes.find((a:any)=>a.id===id);if(!inherited?.values?.length)throw new BadRequestException(`O modelo não informou ${id}.`);
          return {id,values:inherited.values.map((v:any)=>({id:v.id??null,name:v.name??null}))};
        });
        return {additionalOffer:additionalOffers.get(row.sku),replacementOffers:replacements.get(row.sku),publicationAttributes:[...packageAttributes,...(sizeChart?[{id:'SIZE_GRID_ID',name:'ID da tabela de medidas',values:[{id:null,name:sizeChart.id}]},{id:'SIZE_GRID_ROW_ID',name:'ID da linha da tabela de medidas',values:[{id:null,name:gridRow}]}]:[]),{id:'SELLER_SKU',name:'SKU',values:[{id:null,name:row.sku}]}],sku:row.sku,color:row.color,size:row.size,productVariantId:row.id,variant:{attributes,pictures:model.pictures.map((p:any)=>({id:p.id}))}};
      })};
  }

  async enqueue(plan:PublicationPlan,userId:string) {
    this.requireAtomicPublication(plan);
    const legacyKey=createHash('sha256').update(JSON.stringify([plan.accountId,plan.familyId,plan.price,plan.rows.map(r=>r.sku).sort()])).digest('hex');
    const replacements=plan.rows.flatMap(row=>row.replacementOffers??[]);
    const key=createHash('sha256').update(JSON.stringify([legacyKey,plan.sizeChart?.id??null,...(replacements.length?[replacements]:[]),...plan.rows.filter(row=>row.additionalOffer).map(row=>row.additionalOffer)])).digest('hex');
    const existing=await this.prisma.auditLog.findFirst({where:{action:'CHAT_FAMILY_PUBLICATION_JOB',entityId:key,userId},orderBy:{createdAt:'desc'}});
    if(existing&&(existing.before as any)?.cancelRequested)throw new BadRequestException('A publicação anterior foi cancelada. Confira o que já foi enviado antes de preparar outra inclusão.');
    if(existing&& !['COMPLETE','FAILED','WAITING_DATA'].includes((existing.after as any)?.status))return {jobId:existing.id};
    const previous=await this.prisma.auditLog.findFirst({where:{action:'CHAT_FAMILY_PUBLICATION_JOB',entityId:legacyKey,userId},orderBy:{createdAt:'desc'}});
    if(previous&&!['COMPLETE','FAILED','WAITING_DATA'].includes((previous.after as any)?.status)){if(replacements.length)throw new BadRequestException('Uma publicação anterior está em andamento. Confira seu resultado antes de substituir ofertas.');if((previous.after as any)?.plan?.sizeChart?.id!==plan.sizeChart?.id)throw new BadRequestException('A publicação anterior ainda está em andamento. Aguarde antes de trocar sua tabela.');return {jobId:previous.id};}
    const job:Job={status:'QUEUED',plan,publicationPolicy:plan.publicationPolicy,rows:plan.rows.map(row=>({sku:row.sku,status:'QUEUED',message:'Aguardando consulta de estoque e publicação.'})),nextAt:Date.now()};
    const row=await this.prisma.auditLog.create({data:{action:'CHAT_FAMILY_PUBLICATION_JOB',entityType:'FamilyPublication',entityId:key,userId,before:{accountId:plan.businessId,marketplaceAccountId:plan.accountId,familyId:plan.familyId},after:job as unknown as Prisma.InputJsonValue}});
    void this.tick().catch(()=>{});
    return {jobId:row.id};
  }

  async status(id:string,businessId:string,userId:string) {
    const row=await this.prisma.auditLog.findFirst({where:{id,action:'CHAT_FAMILY_PUBLICATION_JOB',userId,before:{path:['accountId'],equals:businessId}}});
    if(!row)throw new BadRequestException('Publicação não encontrada nesta conta.');
    const job=row.after as unknown as Job;
    const cancelled=(row.before as any)?.cancelRequested;
    const groups=Array.from({length:Math.ceil(job.rows.length/VARIATION_BATCH_SIZE)},(_,index)=>job.rows.slice(index*VARIATION_BATCH_SIZE,(index+1)*VARIATION_BATCH_SIZE));
    const batches={size:VARIATION_BATCH_SIZE,total:groups.length,completed:groups.filter(group=>group.every(state=>['ACTIVE','PUBLISHED_NO_STOCK'].includes(state.status))).length};
    return {batches,jobId:row.id,status:cancelled?'CANCELLED':job.status,publicationPolicy:job.plan.publicationPolicy??job.publicationPolicy??'ALL_OR_NOTHING',total:job.rows.length,published:job.rows.filter(r=>['ACTIVE','PUBLISHED_NO_STOCK'].includes(r.status)).length,active:job.rows.filter(r=>r.status==='ACTIVE').length,withoutStock:job.rows.filter(r=>['NO_STOCK','PUBLISHED_NO_STOCK'].includes(r.status)).length,rows:job.rows,message:cancelled?'Publicação cancelada. Novas etapas não serão enviadas. Solicitações já enviadas podem concluir e não são desfeitas.':this.message(job)};
  }
  async acceptVerifiedPrices(id:string,businessId:string,userId:string,prices:Record<string,number>){
    const record=await this.prisma.auditLog.findFirst({where:{id,action:'CHAT_FAMILY_PUBLICATION_JOB',userId,before:{path:['accountId'],equals:businessId}}});
    if(!record)throw new BadRequestException('Publicação não encontrada nesta conta.');
    const job=structuredClone(record.after) as unknown as Job;
    for(const row of job.rows){const price=prices[row.sku];if(price!==undefined){if(!Number.isFinite(price)||price<=0)throw new BadRequestException('Preço verificado inválido.');row.verifiedPrice=price;}}
    const updated=await this.prisma.auditLog.updateMany({where:{id,after:{equals:record.after as Prisma.InputJsonValue}},data:{after:job as unknown as Prisma.InputJsonValue}});
    if(updated.count!==1)throw new BadRequestException('A publicação mudou durante a conferência. Consulte o resultado novamente.');
  }

  async latestForModels(businessId:string,userId:string,mlbs:string[]){
    if(!mlbs.length)return null;
    const record=await this.prisma.auditLog.findFirst({where:{action:'CHAT_FAMILY_PUBLICATION_JOB',userId,before:{path:['accountId'],equals:businessId},OR:mlbs.map(mlb=>({after:{path:['plan','modelMlb'],equals:mlb}}))},orderBy:{createdAt:'desc'},select:{id:true}});
    return record?this.status(record.id,businessId,userId):null;
  }

  private message(job:Job){return [job.blockedReason,...job.rows.map(row=>`${row.sku}${row.mlb?' · '+row.mlb:''}: ${job.status==='WAITING_DATA'&&row.status==='QUEUED'?'Não enviada: o lote foi interrompido antes desta variação. Revise a seleção para preparar uma nova prévia.':row.message.includes('seller.optin.fake')?FINALIZED_MESSAGE:row.message}`)].filter(Boolean).join('\n');}
  private async assertNotCancelled(id:string,job:Job){
    const record=await this.prisma.auditLog.findFirst({where:{id,action:'CHAT_FAMILY_PUBLICATION_JOB'},select:{before:true}});
    if(!(record?.before as any)?.cancelRequested)return;
    job.status='CANCELLED';job.leaseUntil=0;job.updatedAt=new Date().toISOString();
    job.blockedReason='Cancelada pelo usuário. Solicitações já enviadas podem concluir; nenhuma alteração será desfeita.';
    for(const row of job.rows)if(!['ACTIVE','PUBLISHED_NO_STOCK','FAILED'].includes(row.status)){row.status='CANCELLED';row.message='Etapa cancelada. Confira no Mercado Livre se uma solicitação anterior foi aplicada.';}
    await this.prisma.auditLog.update({where:{id},data:{after:job as unknown as Prisma.InputJsonValue}});
    throw new PublicationCancelled();
  }
  private async persist(id:string,job:Job){await this.assertNotCancelled(id,job);await this.prisma.auditLog.update({where:{id},data:{after:job as unknown as Prisma.InputJsonValue}});}
  private async save(id:string,job:Job){job.updatedAt=new Date().toISOString();job.leaseUntil=Date.now()+10*60_000;await this.persist(id,job);}
  private owner(value:any,plan:PublicationPlan){if(String(value.user_id??value.seller_id)!==plan.sellerId)throw new BadRequestException('O recurso consultado pertence a outro vendedor.');}
  private sameVariant(up:any,row:PublicationPlan['rows'][number]){
    return matchesCatalogVariant(row,up);
  }
  private async pendingCorrection(token:string,sellerId:string,item:any){
    if(!item.sub_status?.some((status:string)=>['waiting_for_patch','forbidden'].includes(status)))return '';
    const moderation=await this.client.getItemModerations(token,sellerId,item.id);
    const latest=moderation.infractions?.find(entry=>entry.related_item_id===item.id);
    const reason=latest?.reason||'O Mercado Livre exige uma correção no anúncio.';
    return `${item.id}: ${reason} ${latest?.remedy??''} Corrija a pendência em “Ver detalhe” no Mercado Livre antes de substituir. Nenhuma nova oferta foi publicada.`;
  }
  private async closeReplacementOffers(id:string,job:Job,token:string,requested:PublicationPlan['rows'][number],state:PublicationRow){
    if(requested.replacementOffers?.length&&!state.offerSent&&!state.mlb){
      const approvedIds=new Set(requested.replacementOffers.map(offer=>offer.id));
      const upId=requested.replacementOffers[0].upId;
      for(const mlb of await this.client.searchUserProductOffers(token,job.plan.sellerId,upId)){
        if(approvedIds.has(mlb))continue;
        const offer=await this.client.getItem(token,mlb);this.owner(offer,job.plan);
        if(offer.user_product_id!==upId||offer.status!=='closed')throw new BadRequestException('Outra oferta existe para este tamanho. A oferta antiga não será encerrada.');
      }
    }
    for(const approved of requested.replacementOffers??[]){
      if(state.replacementClosed?.includes(approved.id))continue;
      await this.assertNotCancelled(id,job);
      let old=await this.client.getItem(token,approved.id);this.owner(old,job.plan);
      if(old.user_product_id!==approved.upId)throw new BadRequestException('A oferta a substituir pertence a outra variante.');
      const correction=await this.pendingCorrection(token,job.plan.sellerId,old);
      if(correction){state.status='WAITING_DATA';state.message=correction;job.status='WAITING_DATA';job.leaseUntil=0;await this.persist(id,job);return false;}
      if(!state.replacementSent?.includes(approved.id)){
        if(old.status!=='under_review'||replacementFingerprint(old)!==approved.fingerprint)throw new BadRequestException('A oferta em análise mudou após a prévia. Prepare outra seleção.');
        state.replacementSent=[...(state.replacementSent??[]),approved.id];state.status='CLOSING_REPLACEMENT';await this.save(id,job);
        try{await this.client.updateItem(token,approved.id,{status:'closed'});}catch(error){
          // Never resend an ambiguous closure; read back before publishing.
          old=await this.client.getItem(token,approved.id);if(old.status!=='closed')throw error;
        }
      }
      old=await this.client.getItem(token,approved.id);this.owner(old,job.plan);
      if(old.user_product_id!==approved.upId||old.status!=='closed'){
        state.status='WAITING_DATA';state.message=`${approved.id}: o Mercado Livre retornou ${old.status}, sem confirmar o encerramento. Confira a oferta antes de tentar novamente. Nenhuma substituta foi publicada.`;job.status='WAITING_DATA';job.leaseUntil=0;await this.persist(id,job);return false;
      }
      await this.prisma.marketplaceListing.updateMany({where:{marketplaceAccountId:job.plan.accountId,itemId:approved.id},data:{status:'closed',rawData:old as unknown as Prisma.InputJsonValue,lastSyncedAt:new Date()}});
      state.replacementClosed=[...(state.replacementClosed??[]),approved.id];await this.save(id,job);
    }
    return true;
  }
  private hasPublicationAttributes(up:any,attributes:any[]){return attributes.every(expected=>expected.values.every((value:any)=>up.attributes?.find((actual:any)=>actual.id===expected.id)?.values?.some((actual:any)=>normalize(actual.name)===normalize(value.name))));}
  private async ensurePublicationData(id:string,job:Job,token:string,family:any,products:any[],up:any,requested:PublicationPlan['rows'][number]){
    if(!requested.publicationAttributes)return true;
    if(requested.additionalOffer){
      // A new sale offer inherits this UP's product data. Its SKU is set on
      // the new item below; do not rewrite the existing family to add an offer.
      // The row ID already includes its chart ID; newly created UPs can omit
      // the redundant SIZE_GRID_ID while keeping the correct row reference.
      const chart=requested.publicationAttributes.filter(attribute=>attribute.id==='SIZE_GRID_ROW_ID');
      if(!this.hasPublicationAttributes(up,chart))throw new BadRequestException('O cadastro deste tamanho usa outra tabela de medidas. Escolha o guia existente antes de adicionar a nova oferta.');
      return true;
    }
    if(job.metadataTaskId){const task=await this.client.getFamilyTask(token,job.metadataTaskId);if(task.status!=='finished')return false;if(task.user_products?.some((result:any)=>result.status==='failed'))throw new BadRequestException('O Mercado Livre recusou a associação do guia, SKU ou pacote. Confira os dados da publicação.');}
    if(this.hasPublicationAttributes(up,requested.publicationAttributes)){delete job.metadataTaskId;delete job.metadataSent;return true;}
    if(job.metadataSent)return false;
    const members=await this.client.getFamilyUserProducts(token,job.plan.familyId);
    if(members.user_products_ids.length!==products.length||members.user_products_ids.some(member=>!products.some(product=>product.id===member)))return false;
    const userProducts=products.map(product=>{
      const row=job.plan.rows.find(candidate=>this.sameVariant(product,candidate));
      const attributes=product.attributes.filter((attribute:any)=>family.child_attributes_ids.includes(attribute.id)).map((attribute:any)=>({id:attribute.id,name:attribute.name,values:attribute.values.map((value:any)=>({id:value.id??null,name:value.name??null}))}));
      const publication=row?.publicationAttributes??(job.plan.sizeChart?[{id:'SIZE_GRID_ID',name:'ID da tabela de medidas',values:[{id:null,name:job.plan.sizeChart.id}]},{id:'SIZE_GRID_ROW_ID',name:'ID da linha da tabela de medidas',values:[{id:null,name:job.plan.sizeChart.rows[normalize(product.attributes.find((attribute:any)=>attribute.id==='SIZE')?.values?.[0]?.name)]}]}]:[]);
      for(const attribute of publication){if(attribute.values.some((value:any)=>value.name==null))throw new BadRequestException('Um tamanho existente na família não está no guia do modelo.');const index=attributes.findIndex((current:any)=>current.id===attribute.id);if(index>=0)attributes[index]=attribute;else attributes.push(attribute);}
      return {id:product.id,attributes};
    });
    job.metadataSent=true;await this.save(id,job);
    try{const task=await this.client.updateFamilyVariants(token,job.plan.familyId,userProducts);job.metadataTaskId=task.task_id;if(!job.metadataTaskId)throw new Error('Resposta sem confirmação da associação de dados');await this.save(id,job);}
    catch(error){if([400,403,404,422,429].includes((error as any)?.response?.status)){delete job.metadataSent;await this.save(id,job);}throw error;}
    return false;
  }
  private error(error:any){if(error instanceof BadRequestException)return error.message;if(!error?.response&&typeof error?.message==='string'&&/Bling|estoque disponível/.test(error.message))return error.message.slice(0,500);const status=error?.response?.status;const source=String(error?.config?.url??'').includes('api.bling.com.br')?'Bling':'Mercado Livre';const codes=(error?.response?.data?.cause??[]).filter((c:any)=>c.type!=='warning').map((c:any)=>c.code).filter((c:any)=>typeof c==='string'&&/^[\w.:-]{1,100}$/.test(c)).slice(0,5);const message=error?.response?.data?.message;const detail=typeof message==='string'&&message.length<300&&!/token|Bearer|APP_USR/i.test(message)?message:undefined;return `${source}${status?' ('+status+')':''}${codes.length?': '+codes.join(', '):detail?': '+detail:': não foi possível concluir esta etapa.'}`;}

  async tick() {
    if(this.busy)return;this.busy=true;
    try {
      const jobs=await this.prisma.auditLog.findMany({where:{action:'CHAT_FAMILY_PUBLICATION_JOB',OR:[{after:{path:['status'],equals:'QUEUED'}},{after:{path:['status'],equals:'WAITING'}},{after:{path:['status'],equals:'WAITING_STOCK'}},{after:{path:['status'],equals:'RUNNING'}}]},orderBy:{createdAt:'asc'},take:10});
      for(const record of jobs){const job=record.after as unknown as Job;if((job.nextAt??0)>Date.now()||job.status==='RUNNING'&&(job.leaseUntil??0)>Date.now())continue;
        const claimed=await this.prisma.auditLog.updateMany({where:{id:record.id,after:{equals:record.after as Prisma.InputJsonValue}},data:{after:{...job,status:'RUNNING',leaseUntil:Date.now()+10*60_000} as unknown as Prisma.InputJsonValue}});
        if(!claimed.count)continue;job.status='RUNNING';await this.run(record.id,job,record.userId!);break;
      }
    } finally {this.busy=false;}
  }

  private async run(id:string,job:Job,userId:string) {
    if(job.plan.publicationPolicy!=='PUBLISH_AVAILABLE'&&!this.canGuaranteeAtomicPublication()){
      job.status='WAITING_DATA';job.publicationPolicy='ALL_OR_NOTHING';job.blockedReason=ATOMIC_PUBLICATION_REQUIRED;job.leaseUntil=0;job.updatedAt=new Date().toISOString();
      await this.persist(id,job);return;
    }
    const plan=job.plan;
    try {
      const user=await this.prisma.user.findUnique({where:{id:userId},select:{active:true,role:true,permissions:true}});
      if(!user?.active||!effectivePermissions(user).includes('listings.manage'))throw new BadRequestException('A permissão do usuário para publicar não está mais ativa.');
      const account=await this.prisma.marketplaceAccount.findFirst({where:{id:plan.accountId,marketplace:'MERCADO_LIVRE',businessKey:plan.businessKey,active:true}});
      if(!account||account.sellerId!==plan.sellerId)throw new BadRequestException('A conta do vendedor não está mais disponível.');
      await this.assertNotCancelled(id,job);
      const token=await this.auth.getValidAccessToken(plan.accountId);
      const family=await this.client.getUserProductFamily(token,plan.familyId);this.owner(family,plan);
      const stores=await this.client.getWarehouses(token,plan.sellerId);
      if(!stores.some(s=>String(s.id)===plan.warehouse.store_id&&String(s.user_id)===plan.sellerId&&String(s.network_node_id)===plan.warehouse.network_node_id&&s.status==='active'))throw new BadRequestException('O depósito aprovado não está mais disponível.');
      const members=await this.client.getFamilyUserProducts(token,plan.familyId);const products:any[]=[];
      for(const upId of members.user_products_ids){const up=await this.client.getUserProduct(token,upId);this.owner(up,plan);if(String(up.family_id)===plan.familyId)products.push(up);}
      for(const index of publicationBatchIndices(job.rows)) {
        await this.assertNotCancelled(id,job);
        const requested=plan.rows[index];const state=job.rows[index];if(state.status==='ACTIVE'||state.status==='FAILED')continue;
        const publishedBefore=!!state.mlb&&(state.publicationVerified===true||state.status==='PUBLISHED_NO_STOCK'||state.verifiedPrice!=null);
        let attemptedWrite:string|undefined;
        try {
          const row=await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:plan.businessId,sku:requested.sku}}});
          if(!row||row.id!==requested.productVariantId||row.color!==requested.color||row.size!==requested.size)throw new BadRequestException('SKU, cor ou tamanho mudou no catálogo Bling. Prepare outra proposta.');
          const live=await this.bling.liveStockForSku(plan.businessId,requested.sku);state.stock=live.publishable;state.stockCheckedAt=live.checkedAt;
          const approvedUpId=requested.additionalOffer?.upId??requested.replacementOffers?.[0]?.upId;
          let up:any=state.upId?await this.client.getUserProduct(token,state.upId):approvedUpId?products.find(product=>product.id===approvedUpId):products.find(product=>this.sameVariant(product,requested));
          if(approvedUpId&&!up)throw new BadRequestException('A variante da oferta a substituir não pertence mais à família.');
          if(!up){
            if(state.variantSent){state.status='WAITING';state.message='Aguardando confirmação da criação anterior; não será enviada novamente.';await this.save(id,job);continue;}
            state.variantSent=true;state.status='CREATING_VARIANT';await this.save(id,job);
            attemptedWrite='VARIANT';up=await this.client.addFamilyUserProduct(token,plan.familyId,requested.variant);attemptedWrite=undefined;state.upId=up.id;await this.save(id,job);products.push(up);
          }
          this.owner(up,plan);if(String(up.family_id)!==plan.familyId||!this.sameVariant(up,requested))throw new BadRequestException('A variante não corresponde à cor, tamanho e família aprovados.');
          state.upId=up.id;await this.save(id,job);
          // Verify/close the approved offer before changing shared product data,
          // which can itself update the old item's last_updated fingerprint.
          if(requested.additionalOffer&&!state.offerSent&&!state.mlb){
            for(const product of products.filter(product=>this.sameVariant(product,requested))){
              for(const mlb of await this.client.searchUserProductOffers(token,plan.sellerId,product.id)){
                const current=await this.client.getItem(token,mlb);this.owner(current,plan);
                if(current.user_product_id!==product.id||!['under_review','inactive','closed'].includes(current.status??''))throw new BadRequestException('Outra oferta ativa ou pausada já existe para este tamanho. Prepare uma nova seleção.');
              }
            }
          }
          if(!await this.closeReplacementOffers(id,job,token,requested,state))return;
          if(!state.mlb&&!await this.ensurePublicationData(id,job,token,family,products,up,requested)){
            state.status='WAITING';state.message='Associando guia de medidas, SKU e pacote. A publicação seguirá automaticamente, sem nova confirmação.';job.status='WAITING';job.nextAt=Date.now()+15_000;job.leaseUntil=0;await this.persist(id,job);return;
          }
          if(live.publishable===0&&!plan.publishWithoutStock){state.status='NO_STOCK';state.message=`${requested.color} ${requested.size}: preparada na família, sem saldo disponível na Bling. Aguardando reposição.`;await this.save(id,job);continue;}
          let stock=await this.client.getProductStock(token,up.id);
          if(stock){this.owner(stock.data,plan);if(stock.data.id!==up.id)throw new BadRequestException('O estoque consultado não corresponde à variante.');}
          const location=stock?.data.locations.find((l:any)=>l.type==='seller_warehouse'&&String(l.store_id)===plan.warehouse.store_id&&String(l.network_node_id)===plan.warehouse.network_node_id);
          if(location?.quantity!==live.publishable){
            state.status='SETTING_STOCK';await this.save(id,job);
            if(!stock){
              state.stockSent=true;await this.save(id,job);attemptedWrite='STOCK_INIT';await this.client.initializeWarehouseStock(token,up.id,{...plan.warehouse,quantity:live.publishable});attemptedWrite=undefined;
            }else{
              const locations=stock.data.locations.filter((l:any)=>l.type==='seller_warehouse').map((l:any)=>({store_id:String(l.store_id),network_node_id:String(l.network_node_id),quantity:l.quantity}));
              const selected=locations.find((l:any)=>l.store_id===plan.warehouse.store_id&&l.network_node_id===plan.warehouse.network_node_id);
              if(selected)selected.quantity=live.publishable;else locations.push({...plan.warehouse,quantity:live.publishable});
              await this.assertNotCancelled(id,job);await this.client.updateWarehouseStock(token,up.id,locations,stock.version);
            }
            stock=await this.client.getProductStock(token,up.id);
            if(!stock||!stock.data.locations.some((l:any)=>l.type==='seller_warehouse'&&String(l.store_id)===plan.warehouse.store_id&&String(l.network_node_id)===plan.warehouse.network_node_id&&l.quantity===live.publishable)){state.status='WAITING';state.message='Estoque enviado; aguardando confirmação do depósito.';await this.save(id,job);continue;}
          }
          const oldIds=new Set([...(requested.additionalOffer?.existingIds??[]),...(requested.replacementOffers??[]).map(offer=>offer.id)]);
          const found:string[]=[];
          for(const mlb of (await this.client.searchUserProductOffers(token,plan.sellerId,up.id)).filter(mlb=>!oldIds.has(mlb))){
            const offer=await this.client.getItem(token,mlb);this.owner(offer,plan);
            if(offer.user_product_id!==up.id)throw new BadRequestException('Oferta de outra variante na consulta.');
            if(offer.status!=='closed'&&!offer.sub_status?.includes('deleted'))found.push(mlb);
          }
          if(oldIds.size&&found.length&&!state.offerSent&&!state.mlb)throw new BadRequestException('Outra oferta já foi publicada para este tamanho. Prepare uma nova seleção.');
          let item;
          if(state.mlb){
            item=await this.client.getItem(token,state.mlb);this.owner(item,plan);
            if(item.user_product_id!==up.id)throw new BadRequestException('A oferta pertence a outra variante.');
            if(item.status==='closed'||item.sub_status?.includes('deleted')){
              if(state.offerSent||state.publicationVerified)throw new BadRequestException('A oferta enviada foi encerrada no Mercado Livre. Prepare uma nova prévia; ela não será recriada automaticamente.');
              delete state.mlb;item=undefined;await this.save(id,job);
            }
          }
          if(!item){
            if(found.length===1)item=await this.client.getItem(token,found[0]);
            else if(found.length>1)throw new BadRequestException('Há mais de uma oferta nesta variante. Revise a condição de venda para evitar duplicação.');
          }
          if(item&&!state.offerSent&&!state.publicationVerified&&!['active','paused'].includes(item.status??''))throw new BadRequestException('A oferta existente não está ativa nem pausada. Prepare uma nova prévia para adicionar outra oferta preservando a anterior.');
          if(!item&&!state.offerSent){
            const peers=await this.prisma.auditLog.findMany({where:{action:'CHAT_FAMILY_PUBLICATION_JOB',id:{not:id},AND:[{after:{path:['plan','accountId'],equals:plan.accountId}},{after:{path:['plan','familyId'],equals:plan.familyId}}]},orderBy:{createdAt:'desc'},take:100});
            for(const peer of peers){
              const other=(peer.after as unknown as Job).rows.find(row=>row.sku===requested.sku&&row.offerSent&&(!row.mlb||!oldIds.has(row.mlb)));
              if(!other)continue;
              if(other.mlb){
                const observed=await this.client.getItem(token,other.mlb);this.owner(observed,plan);
                if(observed.user_product_id!==up.id)throw new BadRequestException('Outra execução já enviou uma oferta para este tamanho em outro cadastro. Confira antes de preparar outra inclusão.');
                if(observed.status==='closed'||observed.sub_status?.includes('deleted'))continue;
                if(['active','paused'].includes(observed.status??'')){item=observed;break;}
              }
              state.status='WAITING_DATA';state.message='Outra execução já enviou uma oferta para este SKU. Confira seu resultado antes de preparar outra inclusão. Nenhuma oferta duplicada foi enviada por esta execução.';job.status='WAITING_DATA';job.leaseUntil=0;await this.persist(id,job);return;
            }
          }
          if(!item){
            if(state.offerSent){state.status='WAITING';state.message='Aguardando confirmação da oferta enviada; não será publicada novamente.';await this.save(id,job);continue;}
            state.offerSent=true;state.status='PUBLISHING';await this.save(id,job);attemptedWrite='OFFER';item=await this.client.createUserProductOffer(token,up.id,plan.offer);attemptedWrite=undefined;state.mlb=item.id;await this.save(id,job);
          }
          this.owner(item,plan);if(item.user_product_id!==up.id)throw new BadRequestException('A oferta pertence a outra variante.');
          state.mlb=item.id;
          const attributes=(item.attributes??[]).map(a=>({id:a.id,...(a.value_id!=null?{value_id:a.value_id}:{value_name:a.value_name})})).filter(a=>a.id!=='SELLER_SKU');attributes.push({id:'SELLER_SKU',value_name:requested.sku});
          const currentSku=item.attributes?.find(a=>a.id==='SELLER_SKU')?.value_name;
          const change:Record<string,any>={};if(currentSku!==requested.sku)change.attributes=attributes;
          const expectedPrice=publishedBefore?item.price:state.verifiedPrice??plan.price;
          if(!publishedBefore&&item.price!==expectedPrice)change.price=expectedPrice;if(live.publishable===0&&item.status==='active')change.status='paused';else if(live.publishable>0&&item.status==='paused')change.status='active';
          if(Object.keys(change).length){await this.assertNotCancelled(id,job);await this.client.updateItem(token,item.id,change);}
          const fresh=await this.client.getItem(token,item.id);this.owner(fresh,plan);const freshUp=await this.client.getUserProduct(token,up.id);this.owner(freshUp,plan);
          const identityVerified=String(freshUp.family_id)===plan.familyId&&fresh.user_product_id===up.id&&fresh.price===expectedPrice&&fresh.attributes?.find(a=>a.id==='SELLER_SKU')?.value_name===requested.sku;
          const activeVerified=identityVerified&&fresh.status==='active'&&(fresh.available_quantity??0)>0;
          const zeroVerified=identityVerified&&live.publishable===0&&fresh.status==='paused'&&fresh.available_quantity===0;
          state.publicationVerified=publishedBefore||zeroVerified||activeVerified;
          state.status=zeroVerified?'PUBLISHED_NO_STOCK':activeVerified?'ACTIVE':'WAITING';state.message=zeroVerified?`${requested.color} ${requested.size}: publicada e vinculada ao pai, pausada com estoque Bling zero. Será ativada quando houver saldo.`:activeVerified?`${requested.color} ${requested.size}: publicada, ativa e vinculada ao pai. Estoque Bling consultado: ${live.publishable}.`:`${requested.color} ${requested.size}: oferta enviada; aguardando leitura confirmar status, SKU, preço e vínculo ao pai.`;
          await this.prisma.marketplaceListing.upsert({where:{marketplaceAccountId_itemId:{marketplaceAccountId:plan.accountId,itemId:fresh.id}},update:{userProductId:up.id,title:fresh.title??fresh.id,status:fresh.status??'unknown',price:fresh.price??plan.price,availableQuantity:fresh.available_quantity??0,rawData:fresh as unknown as Prisma.InputJsonValue,lastSyncedAt:new Date()},create:{marketplaceAccountId:plan.accountId,itemId:fresh.id,userProductId:up.id,title:fresh.title??fresh.id,status:fresh.status??'unknown',price:fresh.price??plan.price,availableQuantity:fresh.available_quantity??0,rawData:fresh as unknown as Prisma.InputJsonValue,lastSyncedAt:new Date()}});
          await this.save(id,job);
        }catch(error){
          if(error instanceof PublicationCancelled)throw error;
          const status=(error as any)?.response?.status;
          if(!status&&typeof (error as any)?.message==='string'&&/autorização da Bling|Reconecte a Bling|Bling recusou/.test((error as any).message)){state.status='WAITING';state.message=this.error(error);job.nextAt=Date.now()+60_000;for(const pending of job.rows.filter(row=>row.status==='QUEUED'))pending.message='Aguardando a autorização Bling da conta que fornece o estoque.';await this.save(id,job);break;}
          if(status===429){const header=(error as any)?.response?.headers?.['retry-after'];const seconds=Number(header);job.nextAt=Date.now()+(Number.isFinite(seconds)&&seconds>0?seconds*1000:Math.max(30_000,Date.parse(header)-Date.now()||30_000));state.status='WAITING';state.message='Limite da API: a publicação será retomada após o intervalo exigido.';if(attemptedWrite==='VARIANT')state.variantSent=false;if(attemptedWrite==='OFFER')state.offerSent=false;if(attemptedWrite==='STOCK_INIT')state.stockSent=false;await this.save(id,job);break;}
          if([400,403,404,409,422].includes(status)){if(attemptedWrite==='VARIANT')state.variantSent=false;if(attemptedWrite==='OFFER')state.offerSent=false;if(attemptedWrite==='STOCK_INIT')state.stockSent=false;}
          if(status===400&&(error as any)?.response?.data?.cause?.some((cause:any)=>cause.code==='missing.fashion_grid.grid_id.values')){
            state.status='WAITING_DATA';state.message='A publicação exige uma tabela de medidas que não está associada ao anúncio modelo. As variantes foram preservadas na família; aguardando a tabela correta.';job.status='WAITING_DATA';job.leaseUntil=0;
            await this.persist(id,job);return;
          }
          state.status=[400,403,404,409,422].includes(status)||error instanceof BadRequestException?'FAILED':'WAITING';state.message=this.error(error);await this.save(id,job);
        }
      }
      job.status=job.rows.every(row=>row.status==='ACTIVE')?'COMPLETE':job.rows.every(row=>['ACTIVE','NO_STOCK','PUBLISHED_NO_STOCK'].includes(row.status))?'WAITING_STOCK':job.rows.every(row=>['ACTIVE','FAILED','NO_STOCK','PUBLISHED_NO_STOCK'].includes(row.status))?'FAILED':'WAITING';
      job.nextAt=Math.max(job.nextAt??0,Date.now()+(job.status==='WAITING_STOCK'?15*60_000:30_000));job.leaseUntil=0;await this.persist(id,job);
    } catch(error){if(error instanceof PublicationCancelled)return;job.status='WAITING';job.nextAt=Date.now()+60_000;job.leaseUntil=0;for(const row of job.rows.filter(row=>row.status!=='ACTIVE'))row.message=this.error(error);await this.persist(id,job).catch(cancel=>{if(!(cancel instanceof PublicationCancelled))throw cancel;});}
  }
}


