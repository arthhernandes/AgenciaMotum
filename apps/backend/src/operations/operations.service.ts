import { effectivePermissions } from '../auth/permissions';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';
import { auditSku } from '../listing-links/sku-audit';
import { FISCAL_TEMPLATE_FIELDS, FiscalTemplateDto, PendingQuery } from './operations.dto';
import { paginate } from '../common/pagination';
import { randomUUID } from 'crypto';

@Injectable()
export class OperationsService {
  constructor(private readonly prisma:PrismaService){}
  private async account(id:string){
    const account=await this.prisma.marketplaceAccount.findFirst({where:{id,marketplace:'BLING',active:true},select:{id:true,businessKey:true}});
    if(!account)throw new BadRequestException('Selecione uma conta Bling válida.');return account;
  }
  private async editor(userId:string){
    const user=await this.prisma.user.findUnique({where:{id:userId},select:{role:true,active:true,permissions:true}});
    if(!user?.active||!effectivePermissions(user).includes('templates.manage'))throw new ForbiddenException('Seu usuário pode consultar, mas não alterar modelos fiscais.');
  }
  private async templateScope(account:{id:string;businessKey:string}){
    return account.id;
  }
  async templates(accountId:string){
    const account=await this.account(accountId),scope=await this.templateScope(account);
    const records=await this.prisma.auditLog.findMany({where:{action:'FISCAL_TEMPLATE',entityId:scope},orderBy:{createdAt:'desc'},take:200});
    return records.filter(record=>!(record.after as any)?.archived).map(record=>({id:record.id,...record.after as any}));
  }
  async saveTemplate(accountId:string,userId:string,input:FiscalTemplateDto,id?:string){
    const account=await this.account(accountId);await this.editor(userId);
    const name=input.name.trim();if(!name)throw new BadRequestException('Informe o nome do modelo.');
    const values:Record<string,string>={};
    for(const [field,value] of Object.entries(input.values)){
      if(!(FISCAL_TEMPLATE_FIELDS as readonly string[]).includes(field)||typeof value!=='string'||value.length>100)throw new BadRequestException('O modelo contém campos não permitidos.');
      if(value.trim())values[field]=value.trim();
    }
    if(!Object.keys(values).length)throw new BadRequestException('Preencha ao menos um campo do modelo.');
    if(values.ncm){values.ncm=values.ncm.replace(/[.\s-]/g,'');if(!/^\d{8}$/.test(values.ncm))throw new BadRequestException('O NCM precisa ter 8 dígitos.');}
    if(values.cest){values.cest=values.cest.replace(/[.\s-]/g,'');if(!/^\d{7}$/.test(values.cest))throw new BadRequestException('O CEST precisa ter 7 dígitos.');}
    if(values.origin_type&&!['manufacturer','reseller','imported'].includes(values.origin_type))throw new BadRequestException('Tipo de origem inválido.');
    const state={name,regime:input.regime,values,version:randomUUID(),updatedAt:new Date().toISOString(),updatedBy:userId,archived:false};
    if(!id){const record=await this.prisma.auditLog.create({data:{action:'FISCAL_TEMPLATE',entityType:'FiscalTemplate',entityId:accountId,userId,after:state}});return {id:record.id,...state};}
    const record=await this.prisma.auditLog.findFirst({where:{id,action:'FISCAL_TEMPLATE',entityId:await this.templateScope(account)}});
    if(!record||(record.after as any)?.archived)throw new NotFoundException('Modelo não encontrado nesta conta.');
    if(!input.version||input.version!==(record.after as any)?.version)throw new ConflictException('O modelo mudou. Atualize antes de editar.');
    await this.prisma.$transaction(async tx=>{
      const updated=await tx.auditLog.updateMany({where:{id,after:{equals:record.after as any}},data:{after:state}});
      if(updated.count!==1)throw new ConflictException('O modelo mudou em outra janela.');
      await tx.auditLog.create({data:{action:'FISCAL_TEMPLATE_EDIT',entityType:'FiscalTemplate',entityId:id,userId,before:record.after as any,after:{...state,accountId}}});
    });return {id,...state};
  }
  async archiveTemplate(accountId:string,userId:string,id:string,version:string){
    const account=await this.account(accountId);await this.editor(userId);
    const record=await this.prisma.auditLog.findFirst({where:{id,action:'FISCAL_TEMPLATE',entityId:await this.templateScope(account)}});
    if(!record||(record.after as any)?.archived)throw new NotFoundException('Modelo não encontrado nesta conta.');
    const state=record.after as any;if(!version||state.version!==version)throw new ConflictException('O modelo mudou. Atualize a lista.');
    const after={...state,archived:true,updatedAt:new Date().toISOString(),version:randomUUID()};
    await this.prisma.$transaction(async tx=>{
      const result=await tx.auditLog.updateMany({where:{id,after:{equals:record.after as any}},data:{after}});if(result.count!==1)throw new ConflictException('O modelo mudou.');
      await tx.auditLog.create({data:{action:'FISCAL_TEMPLATE_ARCHIVE',entityType:'FiscalTemplate',entityId:id,userId,before:record.after as any,after:{accountId,...after}}});
    });return {success:true};
  }
  async pending(accountId:string,query:PendingQuery){
    const account=await this.account(accountId);
    const [products,listings]=await Promise.all([
      this.prisma.product.findMany({where:{blingAccountId:account.id},include:{variants:true}}),
      this.prisma.marketplaceListing.findMany({where:{marketplaceAccount:{businessKey:account.businessKey,marketplace:'MERCADO_LIVRE',active:true}},include:{variants:true,links:true}})
    ]);
    const productIds=new Set(products.map(product=>product.id));const byCode=new Map<string,Set<string>>();
    const variantOwners=new Map<string,string>();
    for(const product of products){for(const code of [product.sku,...product.variants.map(variant=>variant.sku)]){if(!byCode.has(code))byCode.set(code,new Set());byCode.get(code)!.add(product.id);}for(const variant of product.variants)variantOwners.set(variant.id,product.id);}
    const related=new Map<string,any[]>();const unmatched:any[]=[];
    for(const listing of listings){
      const owners=new Set<string>();
      for(const code of [sellerSku(listing.rawData),...listing.variants.map(variant=>sellerSku(variant.rawData)||variant.sku)])for(const owner of byCode.get(code??'')??[])owners.add(owner);
      for(const link of listing.links){const owner=link.productId||variantOwners.get(link.productVariantId??'');if(owner&&productIds.has(owner))owners.add(owner);}
      for(const owner of owners){if(!related.has(owner))related.set(owner,[]);related.get(owner)!.push(listing);}
      if(!owners.size)unmatched.push({id:`unlinked:${listing.id}`,sku:'',title:listing.title,reference:listing.itemId,severity:'warning',code:'UNLINKED',message:'Anúncio sem correspondência identificada com o catálogo Bling.',syncedAt:listing.lastSyncedAt});
    }
    const issues=products.flatMap(product=>{
      const ads=related.get(product.id)??[];const audit=auditSku(product,ads);
      return audit.alerts.map((alert,index)=>({id:`${product.id}:${index}`,sku:product.sku,title:product.title,...alert,syncedAt:alert.reference?ads.find(ad=>ad.itemId===alert.reference)?.lastSyncedAt??null:product.updatedAt}));
    }).concat(unmatched);
    const summary={total:issues.length,warning:issues.filter(issue=>issue.severity==='warning').length,info:issues.filter(issue=>issue.severity==='info').length,products:new Set(issues.map(issue=>issue.sku||issue.reference)).size};
    const search=(query.search??'').trim().toLocaleLowerCase('pt-BR');
    const filtered=issues.filter(issue=>(!query.type||query.type==='all'||issue.code===query.type)&&(!query.severity||query.severity==='all'||issue.severity===query.severity)&&(!search||[issue.sku,issue.title,issue.reference,issue.message].some(value=>value?.toLocaleLowerCase('pt-BR').includes(search)))).sort((a,b)=>Number(b.severity==='warning')-Number(a.severity==='warning')||a.sku.localeCompare(b.sku,'pt-BR',{numeric:true}));
    return {...paginate(filtered.slice((query.page-1)*query.limit,query.page*query.limit),query.page,query.limit,filtered.length),summary,generatedAt:new Date().toISOString()};
  }
}
