import {DailySyncService} from '../src/jobs/daily-sync.service';
import {localSyncParts,nextDailySync} from '../src/jobs/daily-sync-time';
describe('Daily sync at 06:00 Sao Paulo',()=>{
 it('schedules tomorrow when activated after 06:00',()=>expect(nextDailySync(new Date('2026-10-20T20:00:00Z')).toISOString()).toBe('2026-10-21T09:00:00.000Z'));
 it('schedules today when before 06:00',()=>expect(nextDailySync(new Date('2026-10-20T08:59:00Z')).toISOString()).toBe('2026-10-20T09:00:00.000Z'));
 it('uses the Brazilian day before midnight UTC',()=>expect(localSyncParts(new Date('2026-10-21T01:00:00Z')).day).toBe('2026-10-20'));
 function setup(){
  let run:any=null;const config:any={id:'config',after:{enabled:true,nextRunAt:'2026-10-21T09:00:00Z'}};
  const tx:any={$queryRaw:jest.fn().mockResolvedValue([{locked:true}])};
  const prisma:any={auditLog:{upsert:jest.fn(async args=>args.where.id==='daily-sync-config'?config:(run??={...args.create,createdAt:new Date('2026-10-21T09:00:00Z')})),findFirst:jest.fn(async()=>run?.after?.status==='RUNNING'?run:null),update:jest.fn(async args=>{if(args.where.id==='daily-sync-config')config.after=args.data.after;else run.after=args.data.after;})},marketplaceAccount:{findMany:jest.fn().mockResolvedValue([{id:'ml',businessKey:'mottum',marketplace:'MERCADO_LIVRE'},{id:'mottum',businessKey:'mottum',marketplace:'BLING'},{id:'origin',businessKey:'outlet4u',marketplace:'BLING'}])},syncExecution:{findFirst:jest.fn().mockResolvedValue(null),findUnique:jest.fn().mockResolvedValue({status:'SUCCESS'})},$transaction:jest.fn(async callback=>callback(tx))};
  const bling:any={sync:jest.fn().mockResolvedValue({id:'execution'})};const ml:any={startBackground:jest.fn().mockResolvedValue({id:'ml-execution'})};
  return {prisma,tx,bling,ml,service:new DailySyncService(prisma,bling,ml),getRun:()=>run};
 }
 it('does not run before the configured due time',async()=>{const f=setup();await f.service.tick(new Date('2026-10-21T08:59:00Z'));expect(f.bling.sync).not.toHaveBeenCalled();});
 it('starts Bling stores before marketplaces, checkpoints execution and does not repeat stages',async()=>{
  const f=setup();const now=new Date('2026-10-21T09:00:00Z');await f.service.tick(now);expect(f.bling.sync).toHaveBeenCalledWith('FULL_SYNC','mottum');expect(f.getRun().after.steps[0].executionId).toBe('execution');
  await f.service.tick(now);await f.service.tick(now);expect(f.bling.sync.mock.calls.map((call:any[])=>call[1])).toEqual(['mottum','origin']);
 });
 it('waits for a manual or paused sync instead of overlapping',async()=>{const f=setup();f.prisma.syncExecution.findFirst.mockImplementation(async(args:any)=>args.where.type?null:{id:'manual',status:'PAUSED'});await f.service.tick(new Date('2026-10-21T09:00:00Z'));expect(f.bling.sync).not.toHaveBeenCalled();});
 it('does not run when another scheduler owns the database lock',async()=>{const f=setup();f.tx.$queryRaw.mockResolvedValue([{locked:false}]);await f.service.tick(new Date('2026-10-21T09:00:00Z'));expect(f.bling.sync).not.toHaveBeenCalled();});
 it('does not start the next stage while the current execution is running',async()=>{const f=setup();const now=new Date('2026-10-21T09:00:00Z');await f.service.tick(now);f.prisma.syncExecution.findUnique.mockResolvedValue({status:'RUNNING'});await f.service.tick(now);expect(f.bling.sync).toHaveBeenCalledTimes(1);});
 it('keeps a failed Bling stage in history and still processes Mercado Livre',async()=>{
  const f=setup();const now=new Date('2026-10-21T09:00:00Z');await f.service.tick(now);
  f.prisma.syncExecution.findUnique.mockResolvedValue({status:'FAILED'});await f.service.tick(now);await f.service.tick(now);
  f.prisma.syncExecution.findUnique.mockResolvedValue({status:'SUCCESS'});await f.service.tick(now);await f.service.tick(now);await f.service.tick(now);
  expect(f.ml.startBackground).toHaveBeenCalledWith('ml','FULL_SYNC');expect(f.getRun().after.status).toBe('PARTIAL');expect(f.getRun().after.steps[0].status).toBe('FAILED');
  await f.service.tick(now);expect(f.ml.startBackground).toHaveBeenCalledTimes(1);
 });
 it('recovers an existing execution instead of creating one again after a checkpoint interruption',async()=>{
  const f=setup();f.prisma.syncExecution.findFirst.mockResolvedValue({id:'previous',status:'RUNNING'});await f.service.tick(new Date('2026-10-21T09:00:00Z'));
  expect(f.getRun().after.steps[0].executionId).toBe('previous');expect(f.bling.sync).not.toHaveBeenCalled();
 });
});
