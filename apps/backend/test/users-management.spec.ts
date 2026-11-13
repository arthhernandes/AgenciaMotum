import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UsersService } from '../src/users/users.service';
import { SaveUserDto } from '../src/users/users.controller';
import { JwtStrategy } from '../src/auth/jwt.strategy';

describe('User administration',()=>{
  const input={name:'Operador',email:'operator@example.com',role:'VIEWER' as const,active:true};
  function setup(){
    const actor={id:'admin',name:'Admin',email:'admin@example.com',role:'ADMIN',active:true,createdAt:new Date(),updatedAt:new Date()};
    const db:any={user:{findUnique:jest.fn().mockResolvedValue(actor),findMany:jest.fn().mockResolvedValue([actor]),create:jest.fn().mockImplementation(({data}:any)=>({...actor,...data,id:'new'})),update:jest.fn().mockImplementation(({data}:any)=>({...actor,...data}))},auditLog:{create:jest.fn()},$executeRaw:jest.fn(),$transaction:jest.fn()};
    db.$transaction.mockImplementation((callback:any)=>callback(db));
    return {db,service:new UsersService(db)};
  }
  it.each(['VIEWER','CONSULTANT'])('blocks %s from listing or changing users',async role=>{
    const {db,service}=setup();db.user.findUnique.mockResolvedValue({role,active:true});
    await expect(service.listManaged('actor')).rejects.toThrow('Somente administradores');
    await expect(service.saveManaged('actor',input,'other')).rejects.toThrow('Somente administradores');
    expect(db.user.findMany).not.toHaveBeenCalled();expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('never selects password hashes when listing',async()=>{const {db,service}=setup();await service.listManaged('admin');expect(db.user.findMany.mock.calls[0][0].select.passwordHash).toBeUndefined();});
  it('requires a password for new users',async()=>{const {service}=setup();await expect(service.saveManaged('admin',input)).rejects.toThrow('Informe uma senha');});
  it('hashes passwords, normalizes email and omits credentials from audit history',async()=>{
    const {db,service}=setup();await service.saveManaged('admin',{...input,email:' Operator@Example.com ',password:'secure-pass-123'});
    const data=db.user.create.mock.calls[0][0].data;expect(data.email).toBe('operator@example.com');expect(await bcrypt.compare('secure-pass-123',data.passwordHash)).toBe(true);
    expect(db.user.create.mock.calls[0][0].select.passwordHash).toBeUndefined();
    const log=db.auditLog.create.mock.calls[0][0].data;expect(log.after.passwordChanged).toBe(true);expect(log.after.passwordHash).toBeUndefined();expect(JSON.stringify(log)).not.toContain('secure-pass-123');
  });
  it('preserves passwords when editing without a new password',async()=>{const {db,service}=setup();await service.saveManaged('admin',input,'other');expect(db.user.update.mock.calls[0][0].data.passwordHash).toBeUndefined();});
  it('prevents self-deactivation and self-demotion',async()=>{const {db,service}=setup();for(const data of [{...input,role:'ADMIN' as const,active:false},input])await expect(service.saveManaged('admin',data,'admin')).rejects.toThrow('próprio acesso');expect(db.user.update).not.toHaveBeenCalled();});
  it('rechecks administrator permissions inside the transaction',async()=>{const {db,service}=setup();db.user.findUnique.mockResolvedValueOnce({role:'ADMIN',active:true}).mockResolvedValueOnce({role:'VIEWER',active:true});await expect(service.saveManaged('admin',input,'other')).rejects.toThrow('Somente administradores');expect(db.user.update).not.toHaveBeenCalled();});
  it('returns a clear duplicate email error',async()=>{const {db,service}=setup();db.user.update.mockRejectedValue({code:'P2002'});await expect(service.saveManaged('admin',input,'other')).rejects.toThrow('Já existe um usuário');});
  it('validates roles, email, password length and boolean status',async()=>{const dto=plainToInstance(SaveUserDto,{name:'A',email:'bad',role:'OWNER',active:'yes',password:'123'});expect((await validate(dto)).map(e=>e.property).sort()).toEqual(['active','email','name','password','role']);});
  it('rejects inactive sessions and uses the current database role instead of the token role',async()=>{
    const users:any={findById:jest.fn().mockResolvedValue({id:'u',email:'u@example.com',name:'User',active:true,role:'VIEWER'})};
    const strategy=new JwtStrategy(new ConfigService({JWT_SECRET:'test-secret'}),users);
    await expect(strategy.validate({sub:'u',email:'old@example.com',role:'ADMIN'})).resolves.toMatchObject({id:'u',role:'VIEWER',email:'u@example.com'});
    users.findById.mockResolvedValue({active:false});await expect(strategy.validate({sub:'u',email:'x',role:'ADMIN'})).rejects.toThrow('desativado');
  });
});
