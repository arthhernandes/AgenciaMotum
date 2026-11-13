import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireUserPermission } from './permissions';

@Injectable()
export class OAuthStateService {
  constructor(private prisma:PrismaService){}
  async create(provider:string,account:string,userId:string){
    await requireUserPermission(this.prisma,userId,'connections.manage');
    const state=randomUUID();
    await this.prisma.auditLog.create({data:{userId,action:'OAUTH_AUTHORIZATION',entityType:'OAuthState',entityId:state,after:{status:'PENDING',provider,account,expiresAt:Date.now()+15*60_000}}});
    return state;
  }
  async consume(provider:string,state?:string){
    if(!state||!/^[a-f0-9-]{36}$/.test(state))throw new BadRequestException('Autorização inválida. Inicie a conexão novamente pelo sistema.');
    const row=await this.prisma.auditLog.findFirst({where:{action:'OAUTH_AUTHORIZATION',entityType:'OAuthState',entityId:state}});
    const saved=row?.after as any;
    if(!row?.userId||saved?.provider!==provider||saved?.status!=='PENDING'||saved.expiresAt<Date.now())throw new BadRequestException('Autorização expirada ou já utilizada. Inicie a conexão novamente.');
    await requireUserPermission(this.prisma,row.userId,'connections.manage');
    const claimed=await this.prisma.auditLog.updateMany({where:{id:row.id,after:{equals:row.after as Prisma.InputJsonValue}},data:{after:{...saved,status:'CLAIMED'}}});
    if(claimed.count!==1)throw new BadRequestException('Esta autorização já foi utilizada.');
    return String(saved.account);
  }
}
