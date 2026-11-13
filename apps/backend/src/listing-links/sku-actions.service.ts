import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { groupListings } from '../listings/group-listings';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';
import { auditSku } from './sku-audit';

@Injectable()
export class SkuActionsService {
  constructor(private readonly prisma:PrismaService){}
  async inspect(accountId:string,sku:string){
    const result=await this.find(accountId,[sku]);const parent=result.rows[0];
    if(!parent.found)throw new NotFoundException('SKU pai não encontrado nesta conta.');
    const product=await this.prisma.product.findFirstOrThrow({where:{blingAccountId:accountId,sku},include:{variants:true}});
    const account=await this.prisma.marketplaceAccount.findFirstOrThrow({where:{id:accountId},select:{businessKey:true}});
    const listings=await this.prisma.marketplaceListing.findMany({where:{itemId:{in:parent.announcements.flatMap(ad=>ad.items)},marketplaceAccount:{businessKey:account.businessKey,marketplace:'MERCADO_LIVRE'}},include:{variants:true,links:true}});
    const accounts=await this.prisma.marketplaceAccount.findMany({where:{businessKey:account.businessKey},select:{id:true}});
    const history=await this.prisma.auditLog.findMany({where:{OR:[{action:{in:['CHAT_ML_UPDATE_DETAIL','CHAT_ML_CREATE_DETAIL','LISTING_EDITOR_UPDATE']},entityId:{in:listings.map(listing=>listing.itemId)}},{action:'SKU_CORRECTION_LINK',after:{path:['productId'],equals:product.id}},{action:'CHAT_LINK_SKU_DETAIL',AND:[{OR:[sku,...product.variants.map(v=>v.sku)].map(code=>({after:{path:['sku'],equals:code}}))},{OR:accounts.map(account=>({after:{path:['accountId'],equals:account.id}}))}]}]},orderBy:{createdAt:'desc'},take:100,select:{id:true,action:true,entityId:true,before:true,after:true,createdAt:true,user:{select:{name:true}}}});
    // Return only mutation fields; never return arbitrary stored API payloads or credentials.
    const fields=['sku','price','quantity','available_quantity','status','title','family_name','variations','attributes','productId','productVariantId','listingId','listingVariantId','matchType'];
    const pick=(value:any)=>Object.fromEntries(fields.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
    return {...auditSku(product,listings),history:history.map(log=>({id:log.id,reference:log.entityId,action:log.action,createdAt:log.createdAt,user:log.user?.name??'Usuário removido',status:(log.after as any)?.status??'Registrado',before:pick(log.before),after:pick((log.after as any)?.requested??log.after)}))};
  }
  async queues(accountId:string,userId:string){
    const account=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:'BLING',active:true},select:{id:true}});
    if(!account)throw new BadRequestException('Selecione uma conta Bling válida.');
    const records=await this.prisma.auditLog.findMany({where:{action:'SKU_OPERATION_QUEUE',entityId:accountId,userId},orderBy:{createdAt:'desc'},take:30});
    return records.map(record=>({id:record.id,...record.after as any}));
  }
  async createQueue(accountId:string,userId:string,sku:string,kind:string,references:string[]){
    const parent=(await this.find(accountId,[sku])).rows[0];
    const ads=parent.announcements.filter(ad=>references.includes(ad.reference)&&!ad.conflict);
    if(!ads.length||ads.length!==new Set(references).size)throw new BadRequestException('Selecione anúncios identificados para este SKU.');
    const state={sku,kind,createdAt:new Date().toISOString(),tasks:ads.map(ad=>({reference:ad.reference,title:ad.title,status:'PENDING',message:''}))};
    const record=await this.prisma.auditLog.create({data:{action:'SKU_OPERATION_QUEUE',entityType:'SkuQueue',entityId:accountId,userId,after:state}});
    return {id:record.id,...state};
  }
  async updateQueue(accountId:string,userId:string,id:string,reference:string,status:string,message:string){
    const record=await this.prisma.auditLog.findFirst({where:{id,action:'SKU_OPERATION_QUEUE',entityId:accountId,userId}});
    if(!record)throw new NotFoundException('Fila não encontrada nesta conta.');
    const state=record.after as any;const task=state.tasks.find((task:any)=>task.reference===reference);
    if(!task)throw new BadRequestException('Anúncio fora desta fila.');
    const transitions:Record<string,string[]>={PENDING:['RUNNING'],RUNNING:['SUCCESS','FAILED','PAUSED','REVIEW'],PAUSED:['RUNNING'],FAILED:['RUNNING'],REVIEW:['PAUSED']};
    if(!transitions[task.status]?.includes(status))throw new ConflictException('Esta etapa mudou. Atualize a fila antes de continuar.');
    const next=JSON.parse(JSON.stringify(state));Object.assign(next.tasks.find((task:any)=>task.reference===reference),{status,message:message.slice(0,2000),updatedAt:new Date().toISOString()});
    const updated=await this.prisma.auditLog.updateMany({where:{id,after:{equals:record.after as any}},data:{after:next}});
    if(updated.count!==1)throw new ConflictException('A fila mudou em outra janela. Atualize para continuar.');
    return {id,...next};
  }
  async createSelectionQueue(accountId:string,userId:string,kind:string,references:string[]){
    const account=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:'BLING',active:true},select:{id:true,businessKey:true}});
    if(!account)throw new BadRequestException('Selecione uma conta Bling válida.');
    const refs=[...new Set(references)];
    const listings=await this.prisma.marketplaceListing.findMany({where:{itemId:{in:refs},marketplaceAccount:{marketplace:'MERCADO_LIVRE',businessKey:account.businessKey,active:true}},include:{variants:true,links:{include:{productVariant:{select:{productId:true}}}}}});
    if(!refs.length||refs.some(reference=>!listings.some(listing=>listing.itemId===reference)))throw new BadRequestException('Um anúncio selecionado não pertence à conta atual. Atualize a seleção.');
    const products=await this.prisma.product.findMany({where:{blingAccountId:account.id},select:{id:true,sku:true,variants:{select:{sku:true}}}});
    const owners=new Map<string,Set<string>>();
    for(const product of products)for(const code of [product.sku,...product.variants.map(variant=>variant.sku)]){if(!owners.has(code))owners.set(code,new Set());owners.get(code)!.add(product.id);}
    const tasks=groupListings(listings).map(group=>{
      const ids=new Set<string>();
      for(const listing of group.children){
        for(const link of listing.links){const id=link.productId??link.productVariant?.productId;if(id&&products.some(product=>product.id===id))ids.add(id);}
        for(const code of [sellerSku(listing.rawData),...listing.variants.map((variant:any)=>sellerSku(variant.rawData)||variant.sku)])for(const id of owners.get(code??'')??[])ids.add(id);
      }
      const parentSku=ids.size===1?products.find(product=>product.id===[...ids][0])?.sku:undefined;
      return {reference:group.children[0].itemId,title:group.title,...(parentSku?{parentSku}:{}),status:'PENDING',message:''};
    });
    const state={sku:'',selection:true,kind,createdAt:new Date().toISOString(),tasks};
    const record=await this.prisma.auditLog.create({data:{action:'SKU_OPERATION_QUEUE',entityType:'SkuQueue',entityId:accountId,userId,after:state}});
    return {id:record.id,...state};
  }
  async cancelQueue(accountId:string,userId:string,id:string,reference?:string){
    // Cancellation never erases history or turns a completed operation into a cancelled one.
    for(let attempt=0;attempt<3;attempt++){
      const record=await this.prisma.auditLog.findFirst({where:{id,action:'SKU_OPERATION_QUEUE',entityId:accountId,userId}});
      if(!record)throw new NotFoundException('Fila não encontrada nesta conta.');
      const state=record.after as any;
      if(reference&&!state.tasks.some((task:any)=>task.reference===reference))throw new BadRequestException('Anúncio fora desta fila.');
      const next=JSON.parse(JSON.stringify(state));const changed:any[]=[];
      for(const task of next.tasks){
        if((reference&&task.reference!==reference)||['SUCCESS','CANCELLED'].includes(task.status))continue;
        const running=['RUNNING','REVIEW'].includes(task.status);
        Object.assign(task,{status:'CANCELLED',cancelledAt:new Date().toISOString(),updatedAt:new Date().toISOString(),message:running?'Etapa cancelada. Não haverá retomada pela fila. Alterações já enviadas podem ter sido aplicadas; confira o anúncio.':'Etapa cancelada antes da retomada.'});changed.push(task);
      }
      if(!changed.length){await this.cancelPublications(record,next.tasks.filter((task:any)=>task.status==='CANCELLED'&&(!reference||task.reference===reference)),accountId,userId);return {id,...next,message:'As etapas selecionadas já foram concluídas ou canceladas.'};}
      const result=await this.prisma.auditLog.updateMany({where:{id,after:{equals:record.after as any}},data:{after:next}});
      if(result.count!==1)continue;
      // Request a cooperative stop of publications started for these models while
      // this queue was open. The durable marker lives in `before`, which workers
      // never overwrite when saving progress.
      await this.cancelPublications(record,changed,accountId,userId);
      return {id,...next,message:'Cancelamento salvo. Etapas concluídas foram preservadas. Solicitações já enviadas não são desfeitas.'};
    }
    throw new ConflictException('A fila mudou durante o cancelamento. Atualize e tente novamente.');
  }
  private async cancelPublications(record:any,tasks:any[],accountId:string,userId:string){
    if(record.after?.kind!=='variations'||!tasks.length)return;
    const jobs=await this.prisma.auditLog.findMany({where:{action:'CHAT_FAMILY_PUBLICATION_JOB',userId,createdAt:{gte:record.createdAt},AND:[{before:{path:['accountId'],equals:accountId}},{OR:tasks.map(task=>({after:{path:['plan','modelMlb'],equals:task.reference}}))}]}});
    for(const job of jobs)if((job.after as any)?.status!=='COMPLETE'&&!(job.before as any)?.cancelRequested){
      const marked=await this.prisma.auditLog.updateMany({where:{id:job.id,userId,before:{equals:job.before as any}},data:{before:{...job.before as any,cancelRequested:true,cancelledAt:new Date().toISOString()}}});
      if(marked.count!==1)throw new ConflictException('A fila foi cancelada, mas uma publicação mudou durante a solicitação de parada. Repita o cancelamento para conferir a parada.');
    }
  }
  async find(accountId:string,requested:string[]){
    const account=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:'BLING',active:true},select:{id:true,businessKey:true}});
    if(!account)throw new BadRequestException('Selecione a conta Bling da operação.');
    const skus=[...new Set(requested.map(sku=>sku.trim()).filter(Boolean))];
    if(!skus.length||skus.length>20)throw new BadRequestException('Informe de 1 a 20 SKUs pais.');
    const products=await this.prisma.product.findMany({where:{blingAccountId:account.id,sku:{in:skus}},select:{id:true,sku:true,title:true,variants:{select:{id:true,sku:true}}}});
    const listings=await this.prisma.marketplaceListing.findMany({where:{marketplaceAccount:{marketplace:'MERCADO_LIVRE',businessKey:account.businessKey,active:true}},select:{id:true,itemId:true,marketplaceAccountId:true,title:true,status:true,price:true,availableQuantity:true,soldQuantity:true,rawData:true,variants:true,links:{select:{productId:true,productVariant:{select:{productId:true}}}}}});
    const groups=groupListings(listings);
    const rows=skus.map(sku=>{
      const product=products.find(product=>product.sku===sku);
      if(!product)return {sku,title:'SKU pai não encontrado nesta conta',found:false,variants:0,announcements:[]};
      const codes=new Set([product.sku,...product.variants.map(variant=>variant.sku)]);
      const announcements=groups.filter(group=>group.children.some((listing:any)=>listing.links.some((link:any)=>link.productId===product.id||link.productVariant?.productId===product.id)||codes.has(sellerSku(listing.rawData)??'')||listing.variants.some((variant:any)=>codes.has(sellerSku(variant.rawData)||variant.sku||'')))).map(group=>({id:group.id,reference:group.children[0].itemId,title:group.title,items:group.children.map((listing:any)=>listing.itemId),variations:group.variants.length,conflict:false}));
      return {sku,title:product.title,found:true,variants:product.variants.length,announcements};
    });
    const owners=new Map<string,number>();for(const row of rows)for(const ad of row.announcements)owners.set(ad.id,(owners.get(ad.id)??0)+1);
    for(const row of rows)for(const ad of row.announcements)ad.conflict=(owners.get(ad.id)??0)>1;
    return {rows};
  }
}
