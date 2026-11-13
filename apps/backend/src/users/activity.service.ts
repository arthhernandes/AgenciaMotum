import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../common/pagination';
import { ActivityQuery } from './activity-query';

// Show business changes only; internal authorization and draft payloads are excluded.
export function activityDetails(value:unknown):unknown {
 if(Array.isArray(value))return value.map(activityDetails);
 if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>! /password|token|secret|credential|authorization|cookie|state|buffer|base64/i.test(key)).map(([key,item])=>[key,activityDetails(item)]));
 return value;
}
@Injectable()
export class ActivityService {
 constructor(private readonly prisma:PrismaService){}
 async list(actorId:string,query:ActivityQuery){
  const actor=await this.prisma.user.findUnique({where:{id:actorId},select:{role:true,active:true}});
  if(!actor?.active||actor.role!=='ADMIN')throw new ForbiddenException('Somente administradores podem consultar o histórico.');
  const from=query.from?new Date(query.from.length===10?query.from+'T00:00:00-03:00':query.from):undefined;
  const to=query.to?new Date(query.to.length===10?query.to+'T23:59:59.999-03:00':query.to):undefined;
  if(from&&to&&from>to)throw new BadRequestException('O período informado é inválido.');
  const where:Prisma.AuditLogWhereInput={userId:query.userId||{not:null},NOT:[{action:{in:['OAUTH_AUTHORIZATION','CHAT_PENDING_ACTION']}},{entityType:{in:['PendingAction','PendingChatAction','OAuthState']}}],...(query.action?{action:{contains:query.action,mode:'insensitive'}}:{}),...(from||to?{createdAt:{gte:from,lte:to}}:{})};
  const [rows,total]=await Promise.all([this.prisma.auditLog.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.limit,take:query.limit,select:{id:true,action:true,entityType:true,entityId:true,createdAt:true,before:true,after:true,user:{select:{id:true,name:true,email:true}}}}),this.prisma.auditLog.count({where})]);
  return paginate(rows.map(row=>({...row,before:activityDetails(row.before),after:activityDetails(row.after)})),query.page,query.limit,total);
 }
}
