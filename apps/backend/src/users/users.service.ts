import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { defaultPermissions, effectivePermissions, normalizePermissions } from '../auth/permissions';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: Prisma.UserCreateInput & { role?: UserRole }) {
    return this.prisma.user.create({ data });
  }

  private readonly publicFields={id:true,name:true,email:true,role:true,active:true,permissions:true,createdAt:true,updatedAt:true} as const;
  private async requireAdmin(db:Pick<PrismaService,'user'>,id:string){
    const actor=await db.user.findUnique({where:{id},select:{role:true,active:true}});
    if(!actor?.active||actor.role!=='ADMIN')throw new ForbiddenException('Somente administradores podem gerenciar usuários.');
  }
  async listManaged(actorId:string){
    await this.requireAdmin(this.prisma,actorId);
    const users=await this.prisma.user.findMany({select:this.publicFields,orderBy:[{active:'desc'},{name:'asc'}]});
    return users.map(user=>({...user,permissions:effectivePermissions(user)}));
  }
  async saveManaged(actorId:string,input:{name:string;email:string;role:UserRole;active:boolean;password?:string;permissions?:string[]},id?:string){
    await this.requireAdmin(this.prisma,actorId);
    if(!id&&!input.password)throw new BadRequestException('Informe uma senha para o novo usuário.');
    if(input.password&&Buffer.byteLength(input.password,'utf8')>72)throw new BadRequestException('A senha deve ter até 72 bytes.');
    const passwordHash=input.password?await bcrypt.hash(input.password,12):undefined;
    try{return await this.prisma.$transaction(async tx=>{
      // Serialize administration changes and recheck the acting administrator after the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(60102127)`;
      await this.requireAdmin(tx,actorId);
      const before=id?await tx.user.findUnique({where:{id},select:this.publicFields}):undefined;
      if(id&&!before)throw new NotFoundException('Usuário não encontrado.');
      if(id===actorId&&(!input.active||input.role!=='ADMIN'))throw new BadRequestException('Você não pode desativar seu próprio acesso ou remover seu perfil de administrador.');
      const permissions=input.role==='ADMIN'?defaultPermissions('ADMIN'):input.permissions?normalizePermissions(input.permissions):before&&before.role===input.role?effectivePermissions(before):defaultPermissions(input.role);
      const data={name:input.name.trim(),email:input.email.trim().toLowerCase(),role:input.role,active:input.active,permissions,...(passwordHash?{passwordHash}:{})};
      const user=id?await tx.user.update({where:{id},data,select:this.publicFields}):await tx.user.create({data:{...data,passwordHash:passwordHash!},select:this.publicFields});
      const auditValue=(value:typeof user)=>({id:value.id,name:value.name,email:value.email,role:value.role,active:value.active,permissions:effectivePermissions(value),createdAt:value.createdAt.toISOString(),updatedAt:value.updatedAt.toISOString()});
      await tx.auditLog.create({data:{userId:actorId,action:id?'USER_UPDATED':'USER_CREATED',entityType:'User',entityId:user.id,...(before?{before:auditValue(before)}:{}),after:{...auditValue(user),passwordChanged:!!passwordHash}}});
      return user;
    });}catch(error){if((error as any)?.code==='P2002')throw new ConflictException('Já existe um usuário com este e-mail.');throw error;}
  }
}
