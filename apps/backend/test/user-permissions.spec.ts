import { assertPermissions, assertRoutePermissions, defaultPermissions, effectivePermissions, normalizePermissions, routePermissions } from '../src/auth/permissions';
import { UsersService } from '../src/users/users.service';
import { SaveUserDto } from '../src/users/users.controller';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

describe('Individual permissions',()=>{
  const reader={role:'CONSULTANT',permissions:['listings.view']};
  it('preserves existing profiles when no custom permissions were configured',()=>{
    expect(effectivePermissions({role:'CONSULTANT',permissions:null})).toContain('sync.manage');
    expect(defaultPermissions('VIEWER').every(key=>key.endsWith('.view'))).toBe(true);
  });
  it('treats an explicit empty list as no access rather than restoring profile defaults',()=>expect(effectivePermissions({role:'CONSULTANT',permissions:[]})).toEqual([]));
  it('supports restricting consultants and granting selected actions to viewers',()=>{
    expect(()=>assertPermissions(reader,'listings.manage')).toThrow();
    expect(()=>assertPermissions({role:'VIEWER',permissions:['templates.manage']},'templates.manage')).not.toThrow();
  });
  it('adds read dependencies and removes duplicate permissions',()=>expect(normalizePermissions(['chat.manage','listings.manage','listings.manage'])).toEqual(['chat.manage','chat.view','listings.manage','listings.view']));
  it('keeps administrators fully authorized',()=>expect(()=>assertRoutePermissions({role:'ADMIN',permissions:[]},'POST','/api/users')).not.toThrow());
  it.each([
    ['GET','/api/users'],['GET','/api/users/permission-options'],
    ['POST','/api/chat/listing-editor/prepare'],['POST','/api/chat/listing-editor/photos/upload'],
    ['POST','/api/chat/listing-duplication/titles'],['POST','/api/chat/listing-duplication/job/confirm'],
    ['POST','/api/listing-links/manual'],['POST','/api/chat/listing-fiscal'],
    ['POST','/api/sync/bling'],['POST','/api/sync/bling/id/resume'],
    ['GET','/api/mercadolivre/auth/authorize/id'],['GET','/api/bling/auth/authorize'],
    ['POST','/api/operations/fiscal-templates'],['DELETE','/api/listing-links/id'],
    ['GET','/api/dashboard/summary'],['GET','/api/operations/pending'],
    ['GET','/api/future-unmapped-endpoint']
  ])('blocks a listing reader: %s %s',(method,path)=>expect(()=>assertRoutePermissions(reader,method,path)).toThrow());
  it('allows listing read endpoints while keeping unrelated areas closed',()=>expect(()=>assertRoutePermissions(reader,'GET','/api/listings/grouped')).not.toThrow());
  it('does not let chat read permission confirm actions',()=>expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['chat.view']},'POST','/api/chat/actions/id/confirm')).toThrow());
  it('does not allow a permission named ADMIN to be persisted',async()=>{
    const dto=plainToInstance(SaveUserDto,{name:'Person',email:'user@example.com',active:true,role:'VIEWER',password:'secure-pass',permissions:['ADMIN']});
    expect((await validate(dto)).some(error=>error.property==='permissions')).toBe(true);
  });
  it('stores normalized permissions and records them in the audit history',async()=>{
    const user={id:'other',name:'Person',email:'user@example.com',active:true,role:'VIEWER',permissions:['listings.view'],createdAt:new Date(),updatedAt:new Date()};
    const db:any={user:{findUnique:jest.fn().mockImplementation(({where}:any)=>Promise.resolve(where.id==='admin'?{role:'ADMIN',active:true}:user)),update:jest.fn().mockImplementation(({data}:any)=>({...user,...data}))},auditLog:{create:jest.fn()},$executeRaw:jest.fn()};
    db.$transaction=jest.fn((fn:any)=>fn(db));
    await new UsersService(db).saveManaged('admin',{name:'Person',email:'user@example.com',active:true,role:'VIEWER',permissions:['listings.manage']},'other');
    expect(db.user.update.mock.calls[0][0].data.permissions).toEqual(['listings.manage','listings.view']);
    expect(db.auditLog.create.mock.calls[0][0].data.after.permissions).toEqual(['listings.manage','listings.view']);
  });
  it('does not accidentally classify the OAuth authorization URLs as read-only operations',()=>expect(routePermissions('GET','/api/bling/auth/authorize')).toEqual([['connections.manage']]));
});
