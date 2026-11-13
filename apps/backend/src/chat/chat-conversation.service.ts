import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatToolContext } from './chat-context';

type Message = { role: 'user' | 'assistant'; content: string; batchId?:string;variantPreview?:any[];actions?: any[]; operations?: any[]; toolContext?: ChatToolContext[] };
export type ConversationScope={mode:'listing'|'product'|'multiple';reference:string};

@Injectable()
export class ChatConversationService {
  constructor(private readonly prisma: PrismaService) {}

  private async scope(accountId: string) {
    const account = await this.prisma.marketplaceAccount.findFirst({ where: { id: accountId, marketplace: 'BLING', active: true }, select: { id: true } });
    if (!account) throw new BadRequestException('Selecione uma conta válida para conversar.');
  }

  private where(accountId: string, userId: string) {
    return { action: 'CHAT_CONVERSATION', entityType: 'ChatConversation', entityId: accountId, userId };
  }

  async open(accountId: string, userId: string, id?: string) {
    await this.scope(accountId);
    const conversations = await this.prisma.auditLog.findMany({ where: this.where(accountId, userId), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 });
    let current = id ? await this.prisma.auditLog.findFirst({ where: { ...this.where(accountId, userId), id } }) : conversations[0];
    if (id && !current) throw new NotFoundException('Conversa não encontrada nesta conta e usuário.');
    if (!current) current = await this.create(accountId, userId);
    const messages = this.messages(current.after);
    const listed=conversations.some(row=>row.id===current.id)?conversations:[current,...conversations];
    return { id: current.id,scope:(current.after as any)?.scope??null, messages, conversations: await Promise.all(listed.map(async row => ({
      id: row.id, createdAt: row.createdAt, title: await this.conversationTitle(accountId,row.after)
    }))) };
  }

  private async conversationTitle(accountId:string,value:any){
    const messages=this.messages(value);
    const reference=value?.scope?.reference||messages.find(message=>message.role==='user')?.content||'';
    if(value?.scope?.mode==='multiple')return reference.slice(0,180);
    const explicit=[...reference.matchAll(/\bMLB\d+\b/gi)].map(match=>match[0].toUpperCase());
    const previews=[...messages].reverse().flatMap(message=>[...(message.actions??[]).flatMap(action=>action.preview??[]),...(message.variantPreview??[])]);
    const mlb=explicit.length===1?explicit[0]:!explicit.length?previews.find(preview=>/^MLB\d+$/.test(preview.mlb))?.mlb:null;
    if(!mlb)return reference.slice(0,90)||'Nova conversa';
    const account=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:'BLING',active:true},select:{businessKey:true}});
    if(!account?.businessKey)return mlb;
    const listing=await this.prisma.marketplaceListing.findFirst({where:{itemId:mlb,marketplaceAccount:{marketplace:'MERCADO_LIVRE',businessKey:account.businessKey}},select:{variants:{select:{sku:true}},rawData:true}});
    const skus=[...new Set([...(listing?.variants??[]).map(variant=>variant.sku),(listing?.rawData as any)?.seller_custom_field].filter((sku):sku is string=>typeof sku==='string'&&!!sku))];
    if(!skus.length)return mlb;
    const variants=await this.prisma.productVariant.findMany({where:{blingAccountId:accountId,sku:{in:skus}},select:{sku:true,product:{select:{id:true,title:true,sku:true}}}});
    const products=[...new Map(variants.map(variant=>[variant.product.id,variant.product])).values()];
    if(products.length===1){const product=products[0];return `${mlb} - ${product.title} - ${skus.length===1?variants[0].sku:product.sku}`;}
    return mlb;
  }

  private messages(value: unknown): Message[] {
    const messages = (value as any)?.messages;
    return Array.isArray(messages) ? messages.filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content,
      ...(typeof m.batchId==='string'?{batchId:m.batchId}:{}),...(Array.isArray(m.variantPreview)?{variantPreview:m.variantPreview}:{}),...(Array.isArray(m.actions) ? { actions: m.actions } : {}), ...(Array.isArray(m.operations) ? { operations: m.operations } : {}),
      ...(Array.isArray(m.toolContext) ? { toolContext: m.toolContext } : {}) })) : [];
  }

  async create(accountId: string, userId: string) {
    await this.scope(accountId);
    return this.prisma.auditLog.create({ data: { ...this.where(accountId, userId), after: { messages: [] } } });
  }

  async append(accountId: string, userId: string, id: string, messages: Message[]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await this.prisma.auditLog.findFirst({ where: { ...this.where(accountId, userId), id } });
      if (!row) throw new NotFoundException('Conversa não encontrada nesta conta e usuário.');
      const updated = await this.prisma.auditLog.updateMany({ where: { ...this.where(accountId, userId), id, after: { equals: row.after as Prisma.InputJsonValue } },
        data: { after: {...(row.after as any), messages: [...this.messages(row.after), ...messages] } as Prisma.InputJsonValue } });
      if (updated.count === 1) return;
    }
    throw new ConflictException('A conversa foi atualizada em outra janela. Reabra a conversa para carregar as mensagens.');
  }
  async setScope(accountId:string,userId:string,id:string,scope:ConversationScope){
    await this.scope(accountId);if(!['listing','product','multiple'].includes(scope.mode)||!scope.reference.trim()||scope.reference.length>4000)throw new BadRequestException('Informe o anúncio, produto ou lista de anúncios desta conversa.');
    for(let attempt=0;attempt<3;attempt++){const row=await this.prisma.auditLog.findFirst({where:{...this.where(accountId,userId),id}});if(!row)throw new NotFoundException('Conversa não encontrada nesta conta e usuário.');
      const normalized={mode:scope.mode,reference:scope.reference.trim()};const changed=await this.prisma.auditLog.updateMany({where:{...this.where(accountId,userId),id,after:{equals:row.after as Prisma.InputJsonValue}},data:{after:{...(row.after as any),scope:normalized} as Prisma.InputJsonValue}});if(changed.count)return normalized;
    }throw new ConflictException('A conversa mudou. Atualize antes de escolher o contexto.');
  }
  async replaceAction(accountId:string,userId:string,conversationId:string,oldId:string,replacement:any[]){
    for(let attempt=0;attempt<3;attempt++){
      const where={...this.where(accountId,userId),id:conversationId};
      const row=await this.prisma.auditLog.findFirst({where});if(!row)throw new NotFoundException('Conversa não encontrada.');
      let found=false;
      const messages=this.messages(row.after).map(message=>{
        if(!message.actions?.some(action=>action.id===oldId))return message;
        found=true;return {...message,actions:message.actions.flatMap(action=>action.id===oldId?replacement:[action])};
      });
      if(!found)throw new NotFoundException('Prévia não encontrada nesta conversa.');
      const changed=await this.prisma.auditLog.updateMany({where:{...where,after:{equals:row.after as Prisma.InputJsonValue}},data:{after:{...(row.after as any),messages} as Prisma.InputJsonValue}});
      if(changed.count===1)return;
    }
    throw new ConflictException('A conversa mudou. Atualize para ver a prévia atual.');
  }
  async setBatchActions(accountId:string,userId:string,conversationId:string,batchId:string,actions:any[]){
    for(let attempt=0;attempt<3;attempt++){
      const where={...this.where(accountId,userId),id:conversationId};const row=await this.prisma.auditLog.findFirst({where});if(!row)throw new NotFoundException('Conversa não encontrada.');
      let found=false;const messages=this.messages(row.after).map(message=>{if(message.batchId!==batchId)return message;found=true;return {...message,actions};});
      if(!found)throw new NotFoundException('Lote não encontrado nesta conversa.');
      const changed=await this.prisma.auditLog.updateMany({where:{...where,after:{equals:row.after as Prisma.InputJsonValue}},data:{after:{...(row.after as any),messages} as Prisma.InputJsonValue}});if(changed.count)return;
    }throw new ConflictException('Atualize a conversa para carregar o lote.');
  }
}
