import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatPendingActionsService {
  constructor(private readonly prisma:PrismaService){}
  private where(id:string,accountId:string,userId:string){return {id,action:'CHAT_PENDING_ACTION',entityType:'PendingChatAction',entityId:accountId,userId};}
  async save(action:{id:string;accountId:string;userId:string;[key:string]:unknown}){
    const where=this.where(action.id,action.accountId,action.userId);
    if(await this.prisma.auditLog.findFirst({where}))return;
    await this.prisma.auditLog.create({data:{...where,after:JSON.parse(JSON.stringify({status:'PENDING',payload:action})) as Prisma.InputJsonValue}});
  }
  async load(id:string,accountId:string,userId:string){
    const record=await this.prisma.auditLog.findFirst({where:this.where(id,accountId,userId)});
    const saved=record?.after as any;
    return saved?.status==='PENDING'?saved.payload:undefined;
  }
  async claim(id:string,accountId:string,userId:string,status:'CLAIMED'|'CANCELLED'){
    const where=this.where(id,accountId,userId);
    const record=await this.prisma.auditLog.findFirst({where});
    if(!record||(record.after as any)?.status!=='PENDING')throw new ConflictException('Esta proposta já foi confirmada ou substituída. Consulte o resultado no chat.');
    const claimed=await this.prisma.auditLog.updateMany({where:{...where,after:{equals:record.after as Prisma.InputJsonValue}},data:{after:{...(record.after as any),status} as Prisma.InputJsonValue}});
    if(claimed.count!==1)throw new ConflictException('A proposta foi atualizada em outra janela. Consulte o resultado no chat.');
  }
}
