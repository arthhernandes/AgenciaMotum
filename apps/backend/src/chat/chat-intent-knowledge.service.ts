import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INTENT_KNOWLEDGE, IntentCode, IntentEntry } from './chat-intent-knowledge';

@Injectable()
export class ChatIntentKnowledgeService implements OnModuleInit {
  private cache:IntentEntry[]=[];private loadedAt=0;
  constructor(private readonly prisma:PrismaService){}
  async onModuleInit(){
    for(const entry of INTENT_KNOWLEDGE)await this.prisma.auditLog.upsert({where:{id:`chat-intent-v1-${entry.code}`},create:{id:`chat-intent-v1-${entry.code}`,action:'CHAT_INTENT_KNOWLEDGE',entityType:'ChatIntent',entityId:entry.code,after:entry as unknown as Prisma.InputJsonValue},update:{}});
    await this.snapshot();
  }
  async snapshot():Promise<IntentEntry[]>{
    if(this.cache.length&&Date.now()-this.loadedAt<30000)return this.cache;
    const records=await this.prisma.auditLog.findMany({where:{action:'CHAT_INTENT_KNOWLEDGE',entityType:'ChatIntent'},orderBy:{entityId:'asc'},take:30});
    this.cache=records.flatMap(record=>{
      const saved=record.after as any;const template=INTENT_KNOWLEDGE.find(entry=>entry.code===record.entityId);
      if(!template||!Array.isArray(saved?.examples))return [];
      return [{...template,examples:saved.examples.filter((example:any)=>typeof example==='string'&&example.length<=500).slice(0,100)}];
    });this.loadedAt=Date.now();return this.cache;
  }
  async addExample(userId:string,code:IntentCode,example:string){
    const user=await this.prisma.user.findUnique({where:{id:userId},select:{active:true,role:true}});
    if(!user?.active||user.role!=='ADMIN')throw new ForbiddenException('Somente administradores podem cadastrar exemplos de interpretação.');
    if(!INTENT_KNOWLEDGE.some(entry=>entry.code===code)||typeof example!=='string'||example.trim().length<8||example.length>500)throw new BadRequestException('Informe uma intenção válida e um exemplo entre 8 e 500 caracteres.');
    const id=`chat-intent-v1-${code}`;
    for(let attempt=0;attempt<3;attempt++){
      const record=await this.prisma.auditLog.findUnique({where:{id}});const entry=record?.after as any;
      if(!record)throw new BadRequestException('Base de interpretação não encontrada.');
      const examples=[...new Set([...entry.examples,example.trim()])];if(examples.length>100)throw new BadRequestException('Limite de 100 exemplos por intenção.');
      const result=await this.prisma.auditLog.updateMany({where:{id,after:{equals:record.after as Prisma.InputJsonValue}},data:{after:{...entry,examples} as Prisma.InputJsonValue}});
      if(result.count){this.loadedAt=0;return {...entry,examples};}
    }
    throw new BadRequestException('A base foi atualizada por outro usuário. Tente novamente.');
  }
}
