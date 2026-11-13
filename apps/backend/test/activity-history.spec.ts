import { ActivityService, activityDetails } from '../src/users/activity.service';
import { ActivityQuery } from '../src/users/activity-query';
import { assertRoutePermissions } from '../src/auth/permissions';

describe('Administrator activity history',()=>{
 const setup=()=>{
  const db:any={user:{findUnique:jest.fn().mockResolvedValue({role:'ADMIN',active:true})},auditLog:{findMany:jest.fn().mockResolvedValue([{id:'entry',user:{name:'Operador'},before:{price:100},after:{price:110,accessToken:'secret'}}]),count:jest.fn().mockResolvedValue(51)}};
  return {db,service:new ActivityService(db)};
 };
 it.each(['VIEWER','CONSULTANT'])('rejects %s at the route and service',async role=>{
  expect(()=>assertRoutePermissions({role,permissions:['listings.view']},'GET','/api/users/activity')).toThrow();
  const {db,service}=setup();db.user.findUnique.mockResolvedValue({role,active:true});
  await expect(service.list('actor',new ActivityQuery())).rejects.toThrow('Somente administradores');
  expect(db.auditLog.findMany).not.toHaveBeenCalled();
 });
 it('rejects an inactive administrator',async()=>{
  const {db,service}=setup();db.user.findUnique.mockResolvedValue({role:'ADMIN',active:false});
  await expect(service.list('actor',new ActivityQuery())).rejects.toThrow();
 });
 it('paginates across users, filters dates in Brasilia, and removes credentials',async()=>{
  const {db,service}=setup();
  const result=await service.list('admin',Object.assign(new ActivityQuery(),{page:2,limit:25,userId:'operator',action:'UPDATE',from:'2026-11-01',to:'2026-11-10'}));
  const query=db.auditLog.findMany.mock.calls[0][0];
  expect(query.skip).toBe(25);expect(query.take).toBe(25);expect(query.where.userId).toBe('operator');
  expect(query.where.createdAt.gte.toISOString()).toBe('2026-11-01T03:00:00.000Z');
  expect(query.where.createdAt.lte.toISOString()).toBe('2026-11-11T02:59:59.999Z');
  expect(query.where.NOT[0].action.in).toContain('OAUTH_AUTHORIZATION');
  expect(query.where.NOT[0].action.in).toContain('CHAT_PENDING_ACTION');
  expect(result.data[0].after).toEqual({price:110});expect(result.pagination.total).toBe(51);
  expect(db.auditLog.count.mock.calls[0][0].where).toEqual(query.where);
 });
 it('rejects reversed dates before querying logs',async()=>{
  const {db,service}=setup();await expect(service.list('admin',Object.assign(new ActivityQuery(),{from:'2026-11-10',to:'2026-11-01'}))).rejects.toThrow();
  expect(db.auditLog.findMany).not.toHaveBeenCalled();
 });
 it('removes nested credentials while preserving business details',()=>{
  expect(activityDetails({requested:{price:30,passwordHash:'hidden'},results:[{sku:'ABC',refresh_token:'hidden'}]})).toEqual({requested:{price:30},results:[{sku:'ABC'}]});
 });
});
