import { variantSizeValue } from './variant-size-value';
import { BadRequestException, ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';
import { MercadoLivreClient, MeliItemResponse } from '../mercadolivre/mercadolivre.client';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';
import type { MarketplacePlan, Target } from './chat-marketplace.service';
import { variantColorName } from './variant-color-name';

type Business = {id:string;businessKey:string};
type Account = {id:string;name:string;sellerId:string};
const normalized = (value:unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();

/** Adds product variants to an existing family. Does not create sale listings. */
export class ChatFamilyVariants {
  private readonly locks = new Set<string>();
  constructor(private readonly prisma:PrismaService,private readonly auth:MercadoLivreAuthService,private readonly client:MercadoLivreClient) {}

  private owner(value:any,account:Account) {
    if (String(value.user_id) !== account.sellerId) throw new ForbiddenException('A família ou variação não pertence à conta selecionada.');
  }

  private snapshot(family:any) {
    return createHash('sha256').update(JSON.stringify({familyId:String(family.family_id),name:family.family_name,domain:family.domain_id,user:String(family.user_id),attributes:family.attributes,child:family.child_attributes_ids})).digest('hex');
  }

  private async read(account:Account,token:string,familyId:string) {
    const family = await this.client.getUserProductFamily(token,familyId);
    this.owner(family,account);
    if (String(family.family_id) !== familyId) throw new ConflictException('A família consultada não corresponde à prévia.');
    const members = await this.client.getFamilyUserProducts(token,familyId);
    if (String(members.family_id) !== familyId || !Array.isArray(members.user_products_ids) || members.user_products_ids.length > 1000) throw new BadRequestException('Não foi possível conferir todas as variantes da família.');
    const products = [];
    for (const id of members.user_products_ids) {
      const product = await this.client.getUserProduct(token,id);
      this.owner(product,account);
      if (String(product.family_id) !== familyId) throw new ConflictException('Uma variante mudou de família durante a consulta. Consulte novamente.');
      products.push(product);
    }
    return {family,products};
  }

  async inspect(source:{account:Account;token:string;item:MeliItemResponse}) {
    if (!source.item.user_product_id) throw new BadRequestException('Este anúncio não usa User Products.');
    const model = await this.client.getUserProduct(source.token,source.item.user_product_id);
    this.owner(model,source.account);
    if (!model.family_id) throw new BadRequestException('O produto modelo não possui uma família existente.');
    const familyId = String(model.family_id);
    return {model,familyId,...await this.read(source.account,source.token,familyId)};
  }

  private sameCatalogRow(product:any,color:string,size:string) {
    return [['COLOR',color],['SIZE',size]].every(([id,value]) => product.attributes?.find((a:any) => a.id === id)?.values?.some((actual:any) => normalized(actual.name) === normalized(value)));
  }

  private matches(product:any,body:Record<string,any>) {
    return body.attributes.every((expected:any) => {
      const actual = product.attributes?.find((a:any) => a.id === expected.id);
      return actual && expected.values.every((value:any) => actual.values?.some((current:any) => value.id != null && current.id != null ? String(value.id) === String(current.id) : normalized(value.name) === normalized(current.name)));
    });
  }

  private photos(value:unknown,model:any) {
    if (value == null) return (model.pictures ?? []).map((p:any) => ({id:p.id}));
    if (!Array.isArray(value) || !value.length || value.length > 12) throw new BadRequestException('Informe de 1 a 12 fotos da variação.');
    return value.map(source => {
      if (typeof source !== 'string' || source.length > 2000) throw new BadRequestException('Foto inválida.');
      if (/^\d+-ML[A-Z]\d+_\d+$/.test(source)) return {id:source};
      let url:URL;try {url=new URL(source);} catch {throw new BadRequestException('Use um ID de foto ou URL HTTPS pública.');}
      if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) throw new BadRequestException('Use uma URL HTTPS pública para a foto.');
      return {source};
    });
  }

  async prepare(business:Business,source:{account:Account;token:string;item:MeliItemResponse},variants:any[]):Promise<MarketplacePlan> {
    const {account,token,item} = source;
    if (!item.user_product_id) throw new BadRequestException('Este pai não usa User Products. Use a preparação de variações tradicionais.');
    if (!Array.isArray(variants) || !variants.length || variants.length > 20 || new Set(variants.map(v => v.sku)).size !== variants.length) throw new BadRequestException('Informe de 1 a 20 SKUs distintos para adicionar variantes.');
    const {model,familyId,family,products} = await this.inspect(source);
    const sourceRow = await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:business.id,sku:sellerSku(item) ?? ''}}});
    if (!sourceRow) throw new BadRequestException('O SKU do modelo não foi encontrado na Bling desta conta. Confira o vínculo antes de adicionar variantes.');
    const childIds:string[] = family.child_attributes_ids;
    if (!Array.isArray(childIds) || !childIds.length) throw new BadRequestException('A família não informou os atributos das variantes.');
    let chart:any;
    if(childIds.includes('SIZE_GRID_ROW_ID')){
      const chartId=model.attributes?.find((attribute:any)=>attribute.id==='SIZE_GRID_ID')?.values?.[0]?.name;
      if(!chartId)throw new BadRequestException('O modelo não informou o guia de medidas exigido pela família.');
      chart=await this.client.getSizeChart(token,String(chartId));
      if(String(chart.seller_id)!==account.sellerId)throw new ForbiddenException('O guia de medidas não pertence ao vendedor.');
    }
    const targets:Target[] = [];
    for (const requested of variants) {
      if (typeof requested.sku !== 'string') throw new BadRequestException('Informe o SKU completo da Bling.');
      const row = await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:business.id,sku:requested.sku}}});
      if (!row || row.productId !== sourceRow.productId || !row.color || !row.size) throw new BadRequestException(`O SKU ${requested.sku} não é uma variação com cor e tamanho do produto Bling deste pai.`);
      const attributes = childIds.map(id => {
        if (id === 'COLOR' || id === 'SIZE') return {id,values:[id==='COLOR'?{id:null,name:variantColorName(row.color!)}:variantSizeValue(row.size!,model.attributes)]};
        if(id==='SIZE_GRID_ROW_ID'){
          const gridRow=chart.rows.find((candidate:any)=>candidate.attributes.some((attribute:any)=>attribute.id==='SIZE'&&attribute.values.some((value:any)=>normalized(value.name)===normalized(row.size))));
          if(!gridRow)throw new BadRequestException(`O tamanho ${row.size} não foi encontrado no guia do modelo.`);
          return {id,values:[{id:null,name:String(gridRow.id)}]};
        }
        const inherited = model.attributes?.find((a:any) => a.id === id);
        if (!inherited?.values?.length) throw new BadRequestException(`O modelo não informou o atributo ${id} exigido pela família.`);
        return {id,values:inherited.values.map((v:any) => ({id:v.id ?? null,name:v.name ?? null}))};
      });
      const body = {attributes,pictures:this.photos(requested.fotos,model)};
      if (!body.pictures.length) throw new BadRequestException('A variação precisa de pelo menos uma foto.');
      if (products.some(product => this.sameCatalogRow(product,row.color!,row.size!)) || targets.some(target => JSON.stringify(target.body.attributes) === JSON.stringify(attributes))) throw new BadRequestException(`A variação ${row.color} ${row.size} já existe na família. Não será duplicada.`);
      targets.push({account,mlb:item.id,fingerprint:'',before:{familyId},body,userProductId:item.user_product_id,
        familyVariant:{familyId,familySnapshot:this.snapshot(family),sku:row.sku,productId:row.productId,productVariantId:row.id,color:row.color,size:row.size},
        preview:{mlb:`Família ${familyId}`,title:family.family_name,account:account.name,
          fields:[{field:'Nova variante na família',before:'Não existe',after:`${row.color} ${row.size} — SKU Bling ${row.sku}`},{field:'Fotos',before:'Nova variante',after:JSON.stringify(body.pictures)}],
          notes:['Cria somente a variante dentro da família existente. Não publica anúncio nem cria uma oferta de venda.','Preço e estoque não são alterados nesta etapa. O SKU Bling fica associado ao resultado no histórico do sistema.',...(requested.fotos == null ? [`Fotos herdadas da variação modelo (${model.attributes?.find((a:any) => a.id === 'COLOR')?.values?.[0]?.name ?? item.id}). Confira se mostram a cor correta antes de confirmar.`] : [])]}});
    }
    return {kind:'family_variants',targets};
  }

  private error(error:unknown) {
    if (error instanceof HttpException) return error.message;
    const status = (error as any)?.response?.status;
    if (status === 401) return 'O Mercado Livre recusou a autorização (401). Verifique a conexão para renovar ou reconectar a conta.';
    if (status === 403) return 'O Mercado Livre recusou o acesso às variantes (403). Confira permissões ou políticas de acesso; esse erro não comprova que o token expirou.';
    const codes = ((error as any)?.response?.data?.cause ?? []).filter((c:any) => c.type !== 'warning').map((c:any) => c.code).filter((c:any) => typeof c === 'string' && /^[\w.:-]{1,100}$/.test(c)).slice(0,5);
    return `Não foi possível concluir a criação da variante${codes.length ? ': '+codes.join(', ') : '. Consulte a família antes de repetir.'}`;
  }

  private async check(target:Target,business:Business) {
    const meta = target.familyVariant!;
    const account = await this.prisma.marketplaceAccount.findFirst({where:{id:target.account.id,marketplace:'MERCADO_LIVRE',businessKey:business.businessKey,active:true},select:{id:true,name:true,sellerId:true}});
    if (!account || account.sellerId !== target.account.sellerId) throw new ForbiddenException('A conta da prévia não está mais disponível.');
    const row = await this.prisma.productVariant.findUnique({where:{blingAccountId_sku:{blingAccountId:business.id,sku:meta.sku}}});
    if (!row || row.id !== meta.productVariantId || row.productId !== meta.productId || row.color !== meta.color || row.size !== meta.size) throw new ConflictException('O SKU, cor ou tamanho mudou na Bling. Prepare outra prévia.');
    const token = await this.auth.getValidAccessToken(account.id);
    if (!token) throw new ForbiddenException('Reconecte a conta ao Mercado Livre.');
    const current = await this.read(account,token,meta.familyId);
    if (this.snapshot(current.family) !== meta.familySnapshot) throw new ConflictException('Os atributos do pai mudaram. Prepare outra prévia.');
    if (current.products.some(product => this.sameCatalogRow(product,meta.color,meta.size))) throw new ConflictException('Esta cor e tamanho já existem na família. Nenhuma duplicação será enviada.');
    return {account,token,...current};
  }

  async execute(plan:MarketplacePlan,business:Business,userId:string) {
    const keys = [...new Set(plan.targets.map(t => `${t.account.id}:${t.familyVariant!.familyId}`))];
    if (keys.some(key => this.locks.has(key))) throw new ConflictException('Já existe uma criação de variantes em andamento para esta família.');
    keys.forEach(key => this.locks.add(key));
    const results:Array<{mlb:string;success:boolean;status:string;message:string}> = [];
    try {
      try { for (const target of plan.targets) await this.check(target,business); }
      catch (error) {return {success:false,status:'FAILED',results:[],message:`Nenhuma variante foi enviada: ${this.error(error)}`};}
      for (const target of plan.targets) {
        const meta = target.familyVariant!;
        let auditId:string|undefined;let sent=false;let createdId:string|undefined;
        try {
          const {account,token} = await this.check(target,business);
          const audit = await this.prisma.auditLog.create({data:{userId,action:'CHAT_ML_ADD_FAMILY_VARIANT_DETAIL',entityType:'UserProduct',entityId:meta.familyId,before:{accountId:account.id,familyId:meta.familyId,sku:meta.sku,productVariantId:meta.productVariantId},after:{status:'PENDING',requested:target.body} as Prisma.InputJsonValue}});
          auditId=audit.id;sent=true;
          const created = await this.client.addFamilyUserProduct(token,meta.familyId,target.body);
          createdId=created.id;
          if (typeof createdId !== 'string' || !/^MLBU\d+$/.test(createdId)) throw new Error('Missing created variant ID');
          const fresh = await this.client.getUserProduct(token,createdId);
          this.owner(fresh,account);
          const members = await this.client.getFamilyUserProducts(token,meta.familyId);
          const photosOk = target.body.pictures.every((picture:any) => picture.id && fresh.pictures?.some((actual:any) => actual.id === picture.id));
          // The product's own family_id is authoritative; the family search
          // index can lag after creation and must not cause a false failure.
          const verified = fresh.id === createdId && String(fresh.family_id) === meta.familyId && String(members.family_id) === meta.familyId && this.matches(fresh,target.body) && photosOk;
          await this.prisma.auditLog.update({where:{id:auditId},data:{entityId:createdId,after:{status:verified?'VERIFIED':'UNVERIFIED',familyId:meta.familyId,sku:meta.sku,productVariantId:meta.productVariantId,requested:target.body,observed:{id:fresh.id,family_id:fresh.family_id,attributes:fresh.attributes}} as Prisma.InputJsonValue}});
          results.push({mlb:createdId,success:verified,status:verified?'SUCCESS':'UNVERIFIED',message:verified?`${meta.color} ${meta.size} (SKU Bling ${meta.sku}): variante criada e verificada na família. Nenhum anúncio foi publicado.`:'A variante foi enviada, mas o vínculo à família ainda não foi confirmado. Consulte antes de repetir.'});
        } catch (error) {
          const message = this.error(error);
          if (auditId) try {await this.prisma.auditLog.update({where:{id:auditId},data:{entityId:createdId ?? meta.familyId,after:{status:sent?'UNVERIFIED':'FAILED',familyId:meta.familyId,sku:meta.sku,message}}});} catch {}
          results.push({mlb:createdId ?? `Família ${meta.familyId} · ${meta.sku}`,success:false,status:sent?'UNVERIFIED':'FAILED',message});
          // Do not continue writes after an uncertain creation.
          for (const remaining of plan.targets.slice(results.length)) results.push({mlb:remaining.familyVariant!.sku,success:false,status:'FAILED',message:'Não enviada: o lote foi interrompido. Confira o resultado anterior antes de preparar outra proposta.'});
          break;
        }
      }
      const success=results.every(r => r.success);
      return {success,status:success?'SUCCESS':results.some(r=>r.success)?'PARTIAL':results.some(r=>r.status==='UNVERIFIED')?'UNVERIFIED':'FAILED',results,message:results.map(r=>r.message).join('\n')};
    } finally {keys.forEach(key => this.locks.delete(key));}
  }
}
