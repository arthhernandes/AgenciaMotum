import { blingGrade } from '../bling-grade';
import { normalizeBlingParentSku } from '../parent-sku';
import { HttpService } from '@nestjs/axios';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Marketplace, Prisma, SyncSource, SyncStatus, SyncType } from '@prisma/client';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { ListingMatcherService } from '../../mercadolivre/synchronization/listing-matcher.service';
import { availableBlingStock } from './available-stock';
import { BlingAuthService } from '../bling-auth.service';
import { creationDay } from '../../mercadolivre/synchronization/created-day';
import { normalizeBlingPage, normalizeBlingProduct } from '../bling-api';

interface BlingListProductsResponse {
  itens: Array<{
    id: number;
    sku?: string;
    codigo?: string;
    descricao?: string;
    unidade?: string;
    gtin?: string;
    precos?: { preco?: number; precoPromocional?: number; precoCusto?: number; precoCustoMedio?: number };
    estoque?: { localizacao?: string };
    tipoVariacao?: 'N' | 'P' | 'V';
  }>;
  paginacao: { limit: number; offset: number; total: number };
}

interface BlingStockResponse {
  id: number;
  nome?: string;
  codigo?: string;
  saldo?: number;
  reservado?: number;
  disponivel?: number;
}

interface BlingProductDetail {
  id: number;
  sku?: string;
  descricao?: string;
  tipoVariacao?: 'N' | 'P' | 'V';
  produtoPai?: { id: number; sku?: string; descricao?: string };
  variacoes?: Array<{ id: number; sku?: string; codigo?: string; grade?: Array<{ chave?: string; valor?: string }> }>;
}

@Injectable()
export class BlingSyncService implements OnModuleInit {
  private readonly logger = new Logger(BlingSyncService.name);
  private readonly baseUrl = 'https://api.bling.com.br/Api/v3';
  private nextRequestAt = 0;
  private readonly activeExecutions = new Set<string>();
  private readonly renewedTokens = new Map<string, string>();
  private readonly executionScopes=new Map<string,{createdFrom:string}>();
  private scope(executionId:string){const scope=this.executionScopes.get(executionId);return scope?{scope}:{};}
  syncNewToday(accountId?:string){return this.sync(SyncType.INCREMENTAL_SYNC,accountId,creationDay(new Date())+' 00:00:00');}

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly matcher: ListingMatcherService,
    private readonly auth: BlingAuthService
  ) {}

  async onModuleInit() {
    // Jobs run in this Node process. If the process restarts, any RUNNING rows
    // are orphaned and must become resumable instead of blocking the UI forever.
    const orphaned = await this.prisma.syncExecution.findMany({
      where: { source: SyncSource.BLING, status: SyncStatus.RUNNING }
    });
    for (const execution of orphaned) {
      const saved = execution.errorDetails as { progress?: { nextOffset?: number; total?: number } } | null;
      const nextOffset = saved?.progress?.nextOffset ?? Math.floor(execution.itemsProcessed / 100) * 100;
      const total = saved?.progress?.total ?? execution.itemsProcessed;
      await this.prisma.syncExecution.update({
        where: { id: execution.id },
        data: {
          status: SyncStatus.FAILED,
          finishedAt: new Date(),
          errors: execution.errors + 1,
          errorDetails: {
            ...((execution.errorDetails as any)?.scope?{scope:(execution.errorDetails as any).scope}:{}),
            progress: {
              total,
              nextOffset,
              percent: total ? Math.round((execution.itemsProcessed / total) * 100) : 0,
              message: `Execução interrompida. A próxima sincronização continuará do produto ${nextOffset + 1}.`
            },
            errors: [{ message: 'Backend reiniciado durante a sincronização.' }]
          }
        }
      });
      this.logger.warn(`[BLING] Execução órfã ${execution.id} recuperada no offset ${nextOffset}`);
    }
  }

  async sync(type: SyncType = SyncType.MANUAL_SYNC, marketplaceAccountId?: string,createdFrom?:string) {
    if (!marketplaceAccountId || !await this.prisma.marketplaceAccount.findFirst({where:{id:marketplaceAccountId,marketplace:'BLING',active:true}})) throw new BadRequestException('Selecione uma loja ativa.');
    const current = await this.prisma.syncExecution.findFirst({
      where: { source: SyncSource.BLING, marketplaceAccountId: marketplaceAccountId ?? undefined, status: { in: [SyncStatus.PENDING, SyncStatus.RUNNING, SyncStatus.PAUSED] } },
      orderBy: { createdAt: 'desc' }
    });
    if (current) throw new ConflictException('Já existe uma sincronização Bling em andamento ou pausada.');
    const limit = 100;
    const lastExecution = type === SyncType.MANUAL_SYNC || createdFrom
      ? await this.prisma.syncExecution.findFirst({
        where: { source: SyncSource.BLING, marketplaceAccountId: marketplaceAccountId ?? undefined,type,...(createdFrom?{errorDetails:{path:['scope','createdFrom'],equals:createdFrom}}:{}) },
        orderBy: { createdAt: 'desc' }
      })
      : null;
    const previousFailure = lastExecution?.status === SyncStatus.FAILED ? lastExecution : null;
    const previousProgress = previousFailure?.errorDetails as { progress?: { nextOffset?: number } } | null;
    const resumeOffset = previousFailure
      ? Math.max(0, previousProgress?.progress?.nextOffset ?? Math.floor(previousFailure.itemsProcessed / limit) * limit)
      : 0;
    const initialMessage = resumeOffset > 0
      ? `Retomando sincronização a partir do produto ${resumeOffset + 1}`
      : 'Aguardando início';
    const execution = await this.prisma.syncExecution.create({
      data: {
        type,
        source: SyncSource.BLING,
        marketplaceAccountId,
        status: SyncStatus.PENDING,
        errorDetails: { ...(createdFrom?{scope:{createdFrom}}:{}),progress: { total: 0, percent: 0, nextOffset: resumeOffset, resumedFromExecutionId: previousFailure?.id, message: createdFrom?'Preparando consulta dos produtos criados hoje na Bling':initialMessage } }
      }
    });
    void this.runExecution(execution.id, resumeOffset);
    return execution;
  }

  async runExecution(executionId: string, resumeOffset = 0) {
    const executionScope = await this.prisma.syncExecution.findUnique({ where: { id: executionId }, select: { marketplaceAccountId: true,errorDetails:true } });
    const createdFrom=(executionScope?.errorDetails as any)?.scope?.createdFrom as string|undefined;
    if(createdFrom)this.executionScopes.set(executionId,{createdFrom});
    this.activeExecutions.add(executionId);
    await this.prisma.syncExecution.update({
      where: { id: executionId },
      data: { status: SyncStatus.RUNNING, startedAt: new Date(), errorDetails: { ...this.scope(executionId),progress: { total: 0, percent: 0, nextOffset: resumeOffset, message: createdFrom?'Consultando produtos criados hoje na Bling':resumeOffset ? `Retomando do produto ${resumeOffset + 1}` : 'Conectando na Bling' } } }
    });

    const account = executionScope?.marketplaceAccountId
      ? await this.prisma.marketplaceAccount.findFirst({ where: { id: executionScope.marketplaceAccountId, marketplace: Marketplace.BLING, active: true } })
      : null;
    if (!account?.accessToken) {
      await this.fail(executionId, 'Conta Bling nao conectada. Use o botao Conectar Bling antes de sincronizar.');
      this.activeExecutions.delete(executionId);
      this.executionScopes.delete(executionId);
      return;
    }

    const errors: Array<{ productId?: number; sku?: string; message: string }> = [];
    let processed = resumeOffset;
    let created = 0;
    let updated = 0;
    let total = resumeOffset;
    const limit = 100;
    let nextOffset = resumeOffset;

    try {
      if (resumeOffset) this.logger.log(`[BLING] Retomando sincronização no offset ${resumeOffset}`);
      for (let offset = resumeOffset; offset <= total; offset += limit) {
        if (!(await this.waitUntilRunnable(executionId))) return;
        const page = await this.get<BlingListProductsResponse>('/produtos', account.accessToken, { limit, offset, situacao: 'A',...(createdFrom?{dataCriacao:createdFrom}:{}) });
        total = page.paginacao?.total ?? page.itens.length;
        if (total === 0) break;

        for (const item of page.itens) {
          if (!(await this.waitUntilRunnable(executionId))) return;
          try {
            const itemSku = item.sku || item.codigo;
            if (item.tipoVariacao === 'V') {
              if(createdFrom){
                const child=await this.get<BlingProductDetail>(`/produtos/${item.id}`,account.accessToken);
                if(!child.produtoPai?.id)throw new Error('A Bling não informou o produto pai da nova variação.');
                const wasCreated=await this.syncBaseProduct(account.id,account.accessToken,{id:child.produtoPai.id,sku:child.produtoPai.sku,descricao:child.produtoPai.descricao,tipoVariacao:'P'},new Set([item.id]));
                if(wasCreated!==null)wasCreated?created++:updated++;
              }else this.logger.debug(`[BLING] Variação processada pelo produto pai: ${item.id}`);
            } else {
              const wasCreated = await this.syncBaseProduct(account.id, account.accessToken, item);
              if(wasCreated!==null)wasCreated ? created++ : updated++;
            }
          } catch (error) {
            if ((error as AxiosError).response?.status === 401 || this.errorMessage(error).includes('Reconecte')) throw error;
            errors.push({ productId: item.id, sku: item.sku || item.codigo, message: this.errorMessage(error) });
          } finally {
            processed++;
            if (processed % 5 === 0 || processed === total) {
              await this.updateProgress(executionId, processed, total, created, updated, errors, nextOffset);
            }
          }
        }

        nextOffset = offset + page.itens.length;
        await this.updateProgress(executionId, processed, total, created, updated, errors, nextOffset);
        if (processed >= total || page.itens.length === 0) break;
      }

      // Previous versions created one Product per variation. Once the variant
      // is moved to its authoritative parent, remove only truly orphaned rows.
      if(!createdFrom){
        await this.prisma.product.deleteMany({ where: { blingAccountId: account.id, variants: { none: {} }, links: { none: {} } } });
        // Bling product IDs define families; SKU punctuation is unrestricted.
      }
      const matching = await this.matcher.run(account.id);

      await this.prisma.syncExecution.update({
        where: { id: executionId },
        data: {
          status: errors.length ? SyncStatus.PARTIAL : SyncStatus.SUCCESS,
          finishedAt: new Date(),
          itemsProcessed: processed,
          itemsCreated: created,
          itemsUpdated: updated,
          errors: errors.length,
          errorDetails: { ...this.scope(executionId),progress: { total, percent: 100, nextOffset: 0, message: createdFrom?'Sincronização dos produtos novos concluída':'Sincronização concluída' }, errors, matching }
        }
      });
      this.logger.log(`bling sync finished processed=${processed} errors=${errors.length}`);
    } catch (error) {
      await this.fail(executionId, this.errorMessage(error), processed, created, updated, errors, nextOffset);
    } finally {
      this.activeExecutions.delete(executionId);
      this.executionScopes.delete(executionId);
    }
  }

  async pause(executionId: string) {
    const execution = await this.getBlingExecution(executionId);
    if (execution.status !== SyncStatus.RUNNING) throw new ConflictException('Somente uma sincronização em andamento pode ser pausada.');
    return this.prisma.syncExecution.update({
      where: { id: executionId },
      data: { status: SyncStatus.PAUSED }
    });
  }

  async resume(executionId: string) {
    const execution = await this.getBlingExecution(executionId);
    if (execution.status !== SyncStatus.PAUSED) throw new ConflictException('Esta sincronização não está pausada.');
    const progress = execution.errorDetails as { progress?: { nextOffset?: number } } | null;
    await this.prisma.syncExecution.update({ where: { id: executionId }, data: { status: SyncStatus.RUNNING } });
    if (!this.activeExecutions.has(executionId)) {
      const offset = progress?.progress?.nextOffset ?? Math.floor(execution.itemsProcessed / 100) * 100;
      void this.runExecution(executionId, offset);
    }
    return this.prisma.syncExecution.findUniqueOrThrow({ where: { id: executionId } });
  }

  async cancel(executionId: string) {
    const execution = await this.getBlingExecution(executionId);
    if (execution.status !== SyncStatus.PENDING && execution.status !== SyncStatus.RUNNING && execution.status !== SyncStatus.PAUSED) {
      throw new ConflictException('Esta sincronização já foi encerrada.');
    }
    const details = execution.errorDetails as { progress?: Record<string, string | number | boolean | null>; errors?: Array<Record<string, string | number | boolean | null>> } | null;
    return this.prisma.syncExecution.update({
      where: { id: executionId },
      data: {
        status: SyncStatus.CANCELLED,
        finishedAt: new Date(),
        errorDetails: {
          ...((execution.errorDetails as any)?.scope?{scope:(execution.errorDetails as any).scope}:{}),
          progress: { ...(details?.progress ?? {}), message: `Sincronização cancelada após ${execution.itemsProcessed} produtos.` },
          errors: details?.errors ?? []
        }
      }
    });
  }

  private async getBlingExecution(executionId: string) {
    const execution = await this.prisma.syncExecution.findFirst({ where: { id: executionId, source: SyncSource.BLING } });
    if (!execution) throw new NotFoundException('Sincronização Bling não encontrada.');
    return execution;
  }

  private async waitUntilRunnable(executionId: string) {
    while (true) {
      const execution = await this.prisma.syncExecution.findUnique({ where: { id: executionId }, select: { status: true } });
      if (!execution || execution.status === SyncStatus.CANCELLED) return false;
      if (execution.status !== SyncStatus.PAUSED) return execution.status === SyncStatus.RUNNING;
      await this.delay(1000);
    }
  }

  private async getStock(token: string, productId: number) {
    const response = await this.request<{data:Array<{produto:{id:number};saldoVirtualTotal?:number}>}>('/estoques/saldos', token, { 'idsProdutos[]': productId });
    const balance = response.data?.find(row => Number(row.produto?.id) === productId);
    if (!balance || typeof balance.saldoVirtualTotal !== 'number' || !Number.isFinite(balance.saldoVirtualTotal)) throw new Error('O Bling não retornou o saldo virtual do produto solicitado.');
    return { disponivel: balance.saldoVirtualTotal };
  }

  async liveStockForSku(selectedAccountId:string,sku:string) {
    const selected=await this.prisma.marketplaceAccount.findFirst({where:{id:selectedAccountId,marketplace:Marketplace.BLING,active:true}});
    if (!selected) throw new BadRequestException('Selecione uma conta Bling ativa.');
    const source=selected;
    if (!source?.accessToken) throw new BadRequestException('Reconecte a Bling que fornece o estoque antes de publicar.');
    let row=await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:source.id,sku}}});
    if (!row?.blingVariantId || !/^\d+$/.test(row.blingVariantId)) throw new BadRequestException(`O SKU ${sku} não possui referência de estoque na Bling da conta de origem.`);
    const detail=await this.get<BlingProductDetail>(`/produtos/${row.blingVariantId}`,source.accessToken);
    if (detail.sku !== row.sku) throw new BadRequestException(`A referência Bling não corresponde ao SKU ${sku}. Sincronize o catálogo.`);
    const stock=await this.getStock(source.accessToken,Number(row.blingVariantId));
    const available=availableBlingStock(stock);
    await this.prisma.productVariant.updateMany({where:{OR:[{sku:row.sku,blingAccountId:source.id},{sku,blingAccountId:selected.id}]},data:{stock:available}});
    return {sku,stock:available,publishable:Math.max(0,available),sourceAccountId:source.id,checkedAt:new Date().toISOString()};
  }
  async fiscalProductForSku(selectedAccountId:string,sku:string){
    let source=await this.prisma.marketplaceAccount.findFirst({where:{id:selectedAccountId,marketplace:Marketplace.BLING,active:true}});
    if(!source)throw new BadRequestException('Selecione uma conta Bling ativa.');
    let row=await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:source.id,sku}}});
    let shared=false;

    if(!source?.accessToken||!row?.blingVariantId||!/^\d+$/.test(row.blingVariantId))throw new BadRequestException(`O SKU ${sku} não possui cadastro Bling acessível para consulta fiscal.`);
    const detail=await this.get<any>(`/produtos/${row.blingVariantId}`,source.accessToken);
    if((detail.sku??detail.codigo)!==sku)throw new BadRequestException('O SKU retornado pela Bling não corresponde ao produto solicitado.');
    const tax=detail.tributacao??{};
    const technical={descricaoComplementar:typeof detail.descricaoComplementar==='string'?detail.descricaoComplementar.slice(0,12000):'',grade:Array.isArray(detail.grade)?detail.grade.map((entry:any)=>({chave:entry.chave,valor:entry.valor})):[]};
    if(!technical.descricaoComplementar&&Number.isSafeInteger(detail.produtoPai?.id)&&detail.produtoPai.id!==detail.id){
      try{const parent=await this.get<any>(`/produtos/${detail.produtoPai.id}`,source.accessToken);if(parent.id===detail.produtoPai.id&&typeof parent.descricaoComplementar==='string')technical.descricaoComplementar=parent.descricaoComplementar.slice(0,12000);}catch{/* Keep the child's verified facts when the parent cannot be read. */}
    }
    const normalizedGrade=blingGrade(detail.grade?.find((entry:any)=>entry.chave?.toLowerCase()==='cor')?.valor??row.color,detail.grade?.find((entry:any)=>entry.chave?.toLowerCase()==='tamanho')?.valor??row.size);
    return {sku,...normalizedGrade,name:detail.descricao??'',technical,family:row.productId,salePrice:detail.precos?.precoPromocional||detail.precos?.preco||null,shared,fields:{ncm:detail.ncm??tax.ncm??null,cest:detail.cest??tax.cest??null,ean:detail.gtin??null,measurement_unit:detail.unidade??null,cost:detail.precos?.precoCusto??null,origin_detail:shared?null:detail.origem??tax.origem??null}};
  }
  async publicationSource(accountId:string,inputSku:string){
    const account=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:Marketplace.BLING,active:true}});
    if(!account?.accessToken)throw new BadRequestException('Conecte a Bling da conta selecionada.');
    const sku=normalizeBlingParentSku(inputSku);if(!sku||sku.length>100)throw new BadRequestException('Informe um SKU Bling válido.');
    const variant=await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:accountId,sku}}});
    const products=variant?await this.prisma.product.findMany({where:{id:variant.productId,blingAccountId:accountId},include:{variants:true}}):await this.prisma.product.findMany({where:{blingAccountId:accountId,OR:[{sku:{equals:sku,mode:'insensitive'}},{sku:{startsWith:sku+'-LINHA',mode:'insensitive'}}]},include:{variants:true}});
    if(!products.length)throw new BadRequestException('SKU não encontrado nesta conta Bling. Confira o código ou sincronize os produtos.');
    if(products.length>1)return {matches:products.map(product=>({sku:product.sku,title:product.title}))};
    const product=products[0];if(!/^\d+$/.test(product.blingProductId))throw new BadRequestException('Produto sem identificação Bling válida.');
    const detail=await this.get<any>('/produtos/'+product.blingProductId,account.accessToken);
    if(String(detail.id)!==product.blingProductId||normalizeBlingParentSku(String(detail.sku??detail.codigo)).toUpperCase()!==normalizeBlingParentSku(product.sku).toUpperCase())throw new BadRequestException('O produto retornado pela Bling não corresponde ao SKU pai. Sincronize o catálogo.');
    const images=(entries:any[])=>[...new Set<string>((entries??[]).map(entry=>typeof entry==='string'?entry:entry?.url??entry?.link??entry?.anexo).filter(value=>typeof value==='string'&&/^https:\/\//i.test(value)&&/\.(jpg|jpeg|png|webp)(?:$|\?)|\/image|\/imagen/i.test(value)))].slice(0,12);
    // V3 exposes attachments separately; an empty embedded array does not establish absence.
    const attachmentId=variant?.blingVariantId??product.blingProductId;
    const attachments=(attachmentId===product.blingProductId?detail:await this.get<any>('/produtos/'+attachmentId,account.accessToken)).anexos;
    if(!Array.isArray(attachments))throw new BadRequestException('Não foi possível conferir as fotos na Bling. Tente buscar o SKU novamente.');
    const photos=images([...(detail.anexos??[]),...attachments]);
    const price=(value:any)=>Number(value?.precoPromocional)>0?Number(value.precoPromocional):Number(value?.preco)>0?Number(value.preco):null;
    const grade=Array.isArray(detail.variacoes)&&detail.variacoes.length?detail.variacoes:[detail];
    if(!variant&&grade.some((source:any)=>!product.variants.some(row=>String(source.id)===row.blingVariantId&&(source.sku??source.codigo)===row.sku)))throw new BadRequestException('A grade da Bling mudou. Sincronize os produtos para carregar todas as variações.');
    const rows=product.variants.filter(row=>!variant||row.sku===variant.sku).sort((a,b)=>a.sku.localeCompare(b.sku)).map(row=>{
      const source=grade.find((value:any)=>String(value.id)===row.blingVariantId&&(value.sku??value.codigo)===row.sku);
      if(!source)throw new BadRequestException('A grade da Bling mudou. Sincronize os produtos antes de criar o anúncio.');
      const fields=new Map<string,string>((source.grade??[]).map((entry:any)=>[String(entry.chave).toLowerCase(),entry.valor]));
      return {id:row.id,sku:row.sku,title:source.descricao??row.sku,...blingGrade(fields.get('cor')??row.color,fields.get('tamanho')??row.size),price:price(source.precos)??price(detail.precos),gtin:source.gtin??'',photos:images(source.anexos??[]),stock:row.stock};
    });
    if(!rows.length)throw new BadRequestException('O SKU não possui variações disponíveis no catálogo.');
    const dimensions=detail.dimensoes??{};
    return {product:{id:product.id,sku:product.sku,title:detail.descricao??product.title,description:String(detail.descricaoComplementar??'').replace(/<br\s*\/?\s*>|<\/p>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim(),brand:detail.marca?.nome??'',photos,price:price(detail.precos),dimensions:{height:Number(dimensions.altura)||null,width:Number(dimensions.largura)||null,length:Number(dimensions.comprimento)||null,weightGrams:Math.round(Number(dimensions.pesoBruto||dimensions.pesoLiquido)*1000)||null}},rows};
  }

  async productCostForSku(accountId:string,sku:string){
    const account=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:Marketplace.BLING,active:true}});
    if(!account?.accessToken)throw new BadRequestException('Conecte a Bling desta conta para consultar os custos.');
    const row=await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:account.id,sku}}});
    if(!row?.blingVariantId||!/^\d+$/.test(row.blingVariantId))throw new BadRequestException('Variação sem referência válida na Bling. Sincronize o catálogo.');
    const detail=await this.get<any>(`/produtos/${row.blingVariantId}`,account.accessToken);
    if((detail.sku??detail.codigo)!==sku)throw new BadRequestException('A Bling retornou um SKU diferente do solicitado.');
    const value=detail.precos?.precoCusto;
    const cost=typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
    return {sku,cost,checkedAt:new Date().toISOString(),source:'Bling',message:cost===null?'Custo não informado na Bling.':''};
  }
  async productCostsForParent(accountId:string,productId:string,parentSku:string,skus:string[]){
    const account=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:Marketplace.BLING,active:true}});
    if(!account?.accessToken)throw new BadRequestException('Conecte a Bling desta conta para consultar os custos.');
    if(!/^\d+$/.test(productId))throw new BadRequestException('Produto sem referência válida na Bling.');
    const detail=await this.get<any>(`/produtos/${productId}`,account.accessToken);
    if(normalizeBlingParentSku(String(detail.sku??detail.codigo))!==normalizeBlingParentSku(parentSku))throw new BadRequestException('A Bling retornou um produto pai diferente do solicitado.');
    const candidates=detail.variacoes?.length?detail.variacoes:[detail];const checkedAt=new Date().toISOString();
    const rows=[];
    for(const sku of skus){
      const variant=candidates.find((candidate:any)=>(candidate.sku??candidate.codigo)===sku);
      if(!variant){rows.push({sku,cost:null,checkedAt:null,source:'Bling',stale:true,message:'SKU não encontrado na grade Bling. Sincronize o catálogo.'});continue;}
      if(!variant.precos){rows.push({...await this.productCostForSku(accountId,sku),stale:false});continue;}
      const value=variant.precos.precoCusto;const cost=typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
      rows.push({sku,cost,checkedAt,source:'Bling',stale:false,message:cost===null?'Custo não informado na Bling.':''});
    }
    return rows;
  }

  async refreshCatalogForSkus(accountId:string,skus:string[],context?:{baseSku?:string;mlbs?:string[];title?:string}) {
    const account=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:Marketplace.BLING,active:true}});
    if(!account?.accessToken)throw new BadRequestException('Conecte a Bling desta conta para conferir todas as cores e tamanhos.');
    let rows=await this.prisma.productVariant.findMany({where:{blingAccountId:accountId,sku:{in:skus}},select:{blingVariantId:true,productId:true}});
    if(context?.baseSku||!rows.length&&context?.mlbs?.length){
      const products=await this.prisma.product.findMany({where:{blingAccountId:accountId,...(context.baseSku?{sku:context.baseSku}:{OR:[{links:{some:{listing:{itemId:{in:context.mlbs}}}}},{variants:{some:{links:{some:{listing:{itemId:{in:context.mlbs}}}}}}}]})},select:{id:true,variants:{select:{blingVariantId:true,productId:true}}}});
      if(products.length!==1)throw new BadRequestException(products.length?'Há mais de um produto Bling correspondente. Informe o SKU base correto.':'Não encontrei o produto Bling. Informe o SKU base do produto para conferir sua grade; ele não será aplicado a todas as variações.');
      rows=products[0].variants;
    }
    if(!rows.length)throw new BadRequestException('Não encontrei o produto Bling pelos SKUs do anúncio. Confira o vínculo antes de adicionar variações.');
    const refreshed=new Set<string>();const confirmedSkus=new Set<string>();
    for(const row of rows){
      if(refreshed.has(row.productId))continue;
      if(!row.blingVariantId||!/^\d+$/.test(row.blingVariantId))throw new BadRequestException('O produto não possui referência válida na Bling. Sincronize o catálogo.');
      const child=await this.get<BlingProductDetail>(`/produtos/${row.blingVariantId}`,account.accessToken);
      const parentId=child.produtoPai?.id??child.id;
      const parent=parentId===child.id?child:await this.get<BlingProductDetail>(`/produtos/${parentId}`,account.accessToken);
      if(!parent.variacoes?.length)throw new BadRequestException('A Bling não retornou a grade completa de cores e tamanhos deste produto. Nenhuma prévia incompleta será preparada.');
      for(const variant of parent.variacoes){const sku=variant.sku||variant.codigo;if(!sku)throw new BadRequestException('Uma variação da grade Bling não possui SKU. Confira o cadastro antes de publicar.');confirmedSkus.add(sku);}
      await this.syncBaseProduct(accountId,account.accessToken,{id:parent.id,sku:parent.sku,descricao:parent.descricao,tipoVariacao:'P'});
      refreshed.add(row.productId);
    }
    return [...confirmedSkus];
  }

  private async syncBaseProduct(accountId: string, token: string, item: BlingListProductsResponse['itens'][number],onlyVariantIds?:Set<number>) {
    // Use the provider parent/child relation, never infer families across stores.
    // tipoVariacao=P identifies a parent; GET /produtos/{id}.variacoes contains
    // the authoritative child ids/SKUs. tipoVariacao=N is a simple base product.
    const detail = item.tipoVariacao === 'P'
      ? await this.get<BlingProductDetail>(`/produtos/${item.id}`, token)
      : null;
    if(item.tipoVariacao==='P'&&!Array.isArray(detail?.variacoes))throw new Error('A Bling não retornou a grade do produto pai. Nenhuma variação foi inventada.');
    // Empty parent records are not sellable variations and have no shared stock.
    if(item.tipoVariacao==='P'&&Array.isArray(detail?.variacoes)&&!detail.variacoes.length)return null;
    const rawBaseSku = detail?.sku || item.sku || item.codigo || `BLING-${item.id}`;
    const baseSku = this.normalizeBaseSku(rawBaseSku);
    const existing = await this.prisma.product.findUnique({ where: { blingAccountId_blingProductId: { blingAccountId: accountId, blingProductId: String(item.id) } } });
    const product = await this.prisma.product.upsert({
      where: { blingAccountId_blingProductId: { blingAccountId: accountId, blingProductId: String(item.id) } },
      update: { sku: baseSku, title: detail?.descricao || item.descricao || baseSku },
      create: { blingAccountId: accountId, blingProductId: String(item.id), sku: baseSku, title: detail?.descricao || item.descricao || baseSku, category: item.unidade }
    });
    const variants = detail?.variacoes?.length
      ? detail.variacoes.map((variant) => ({ id: variant.id, sku: variant.sku || variant.codigo, grade: variant.grade }))
      : [{ id: item.id, sku: baseSku, grade: undefined }];
    if(onlyVariantIds&&![...onlyVariantIds].every(id=>variants.some(variant=>variant.id===id)))throw new Error('A nova variação não consta na grade oficial do produto pai.');
    const missingStock:string[]=[];
    for (const variant of variants) {
      if(onlyVariantIds&&!onlyVariantIds.has(variant.id))continue;
      if (!variant.sku) continue;
      const availableStock = availableBlingStock(await this.getStock(token, variant.id));
      if (availableStock == null) {missingStock.push(variant.sku);continue;}
      const grade = new Map((variant.grade ?? []).map((entry) => [entry.chave?.toLowerCase(), entry.valor]));
      const normalizedGrade=blingGrade(grade.get('cor'),grade.get('tamanho'));
      // The provider ID is stable when a seller corrects the SKU. Preserve local
      // identity (and its manual links) instead of creating a second row.
      const providerVariant=await this.prisma.productVariant.findUnique({where:{blingAccountId_blingVariantId:{blingAccountId:accountId,blingVariantId:String(variant.id)}}});
      const variantData={blingVariantId:String(variant.id),sku:variant.sku,stock:availableStock,productId:product.id,color:normalizedGrade.color,size:normalizedGrade.size};
      if(providerVariant)await this.prisma.productVariant.update({where:{id:providerVariant.id},data:variantData});
      else await this.prisma.productVariant.upsert({
        where: { blingAccountId_sku: { blingAccountId: accountId, sku: variant.sku } },
        update: { blingVariantId: String(variant.id), stock: availableStock, productId: product.id, color: normalizedGrade.color, size: normalizedGrade.size },
        create: { productId: product.id, blingAccountId: accountId, blingVariantId: String(variant.id), sku: variant.sku, stock: availableStock, color: normalizedGrade.color, size: normalizedGrade.size }
      });

    }
    if(missingStock.length)throw new Error(`SKU(s) ${missingStock.join(', ')} sem estoque correspondente nesta loja. As demais variações foram atualizadas. Confira os códigos na grade das duas contas.`);
    return !existing;
  }

  private normalizeBaseSku(sku: string) { return sku.trim(); }

  private async get<T>(path: string, token: string, params?: Record<string, string | number>) {
    if (path === '/produtos') {
      const limit = Number(params?.limit ?? 100), offset = Number(params?.offset ?? 0);
      const response = await this.request<{data:unknown}>('/produtos', token, { pagina: Math.floor(offset / limit) + 1, limite: limit, criterio: 2, tipo: 'P', ...(params?.dataCriacao ? { dataInclusaoInicial: params.dataCriacao } : {}) });
      return normalizeBlingPage(response.data, offset, limit) as T;
    }
    const response = await this.request<{data:any}>(path, token, params);
    if (!response.data || typeof response.data !== 'object') throw new Error('Resposta de produto inválida do Bling.');
    if (response.data.formato === 'V') {
      const variations = await this.request<{data:any}>('/produtos/variacoes/' + response.data.id, token);
      if (!Array.isArray(variations.data?.variacoes)) throw new Error('O Bling não retornou a grade completa.');
      return normalizeBlingProduct({...response.data, ...variations.data}) as T;
    }
    return normalizeBlingProduct(response.data) as T;
  }

  private async request<T>(path: string, token: string, params?: Record<string, string | number>) {
    let accessToken = this.renewedTokens.get(token) ?? token;
    let renewed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.throttle();
      try {
        const response = await firstValueFrom(this.http.get<T>(`${this.baseUrl}${path}`, {
          params,
          timeout: 30000,
          headers: { Authorization: `Bearer ${accessToken}` }
        }));
        return response.data;
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 401 && !renewed) {
          const account = await this.prisma.marketplaceAccount.findFirst({ where: { marketplace: Marketplace.BLING, accessToken } });
          if (!account) throw new Error('Reconecte a Bling da conta selecionada em Contas conectadas.');
          accessToken = await this.auth.refreshAccess(account.id);
          this.renewedTokens.set(token, accessToken);
          renewed = true;
          continue;
        }
        if (axiosError.response?.status === 401) throw new Error('A Bling recusou o acesso mesmo após renovar o token. Reconecte a conta e confira as permissões de consulta de produtos e estoque no aplicativo Bling.');
        const transient=[429,500,502,503,504].includes(axiosError.response?.status??0)||['ECONNRESET','ETIMEDOUT','ECONNABORTED','EAI_AGAIN'].includes(axiosError.code??'');
        if (!transient || attempt === 4) throw error;
        const retryAfter = Number(axiosError.response?.headers?.['retry-after'] ?? 0);
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : axiosError.response?.status===429?5000*2**attempt:500*2**attempt;
        this.logger.warn(`[BLING] Falha temporária na consulta. Nova tentativa em ${Math.ceil(waitMs / 1000)}s`);
        await this.delay(waitMs);
      }
    }
    throw new Error('Limite de tentativas da Bling excedido');
  }

  private async throttle() {
    const waitMs = Math.max(0, this.nextRequestAt - Date.now());
    if (waitMs) await this.delay(waitMs);
    // Plano Potencializar: 120 req/min. 650ms keeps a safety margin (~92/min).
    this.nextRequestAt = Date.now() + 650;
  }

  private delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private updateProgress(executionId: string, processed: number, total: number, created: number, updated: number, errors: Array<object>, nextOffset: number) {
    return this.prisma.syncExecution.update({
      where: { id: executionId },
      data: {
        itemsProcessed: processed,
        itemsCreated: created,
        itemsUpdated: updated,
        errors: errors.length,
        errorDetails: { ...this.scope(executionId),progress: { total, nextOffset, percent: total ? Math.round((processed / total) * 100) : 0, message: `Processados ${processed} de ${total}${this.executionScopes.has(executionId)?' produtos novos':''}` }, errors }
      }
    });
  }

  private async fail(executionId: string, message: string, processed = 0, created = 0, updated = 0, errors: Array<object> = [], nextOffset = 0) {
    const execution = await this.prisma.syncExecution.findUnique({ where: { id: executionId }, select: { errorDetails: true } });
    const progress = execution?.errorDetails as { progress?: { total?: number } } | null;
    const total = progress?.progress?.total ?? 0;
    await this.prisma.syncExecution.update({
      where: { id: executionId },
      data: {
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        itemsProcessed: processed,
        itemsCreated: created,
        itemsUpdated: updated,
        errors: errors.length + 1,
        errorDetails: { ...((execution?.errorDetails as any)?.scope?{scope:(execution?.errorDetails as any).scope}:{}),progress: { total, nextOffset, percent: total ? Math.min(100, Math.round(processed / total * 100)) : 0, message: `${message}. A próxima execução continuará do produto ${nextOffset + 1}.` }, errors: [...errors, { message }] }
      }
    });
  }

  private errorMessage(error: unknown) {
    const axiosError = error as AxiosError;
    const response = axiosError.response?.data;
    if (response && typeof response === 'object') return JSON.stringify(response);
    if (error instanceof BadRequestException) return error.message;
    if (error instanceof Error) return error.message;
    return 'Erro desconhecido';
  }
}
