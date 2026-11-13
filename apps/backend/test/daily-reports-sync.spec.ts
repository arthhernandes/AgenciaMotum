import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {DailyReportsSyncService} from '../src/jobs/daily-reports-sync.service';
jest.mock('node:child_process',()=>({...jest.requireActual('node:child_process'),spawn:jest.fn()}));
describe('Daily report imports',()=>{
  const now=new Date('2026-10-23T15:00:00Z');
  function setup(){
    const jobs=new Map<string,any>([['daily-sync-config',{after:{enabled:true}}],['daily-sync:2026-10-23',{after:{status:'SUCCESS'}}]]);
    const auditLog={findMany:jest.fn().mockResolvedValue([]),findUnique:jest.fn(async({where}:any)=>jobs.get(where.id)??null),findFirst:jest.fn().mockResolvedValue(null),create:jest.fn(async({data}:any)=>{jobs.set(data.id,data);return data;}),updateMany:jest.fn().mockResolvedValue({count:1})};
    const tx={auditLog,$queryRaw:jest.fn().mockResolvedValue([{locked:true}])};
    const prisma:any={auditLog,$transaction:jest.fn(async callback=>callback(tx))};
    const child:any=new EventEmitter();child.unref=jest.fn();(spawn as jest.Mock).mockReset().mockReturnValue(child);
    return {jobs,auditLog,tx,prisma,child,service:new DailyReportsSyncService(prisma)};
  }
  it('starts one durable daily pipeline, without replaying after API restart',async()=>{const f=setup();await f.service.tick(now);await new DailyReportsSyncService(f.prisma).tick(now);expect(spawn).toHaveBeenCalledTimes(1);expect(spawn).toHaveBeenCalledWith(process.execPath,[expect.stringMatching(/sync-report-data\.cjs$/),'--job','daily-reports:2026-10-23'],expect.objectContaining({windowsHide:true,stdio:'ignore'}));expect(f.jobs.get('daily-reports:2026-10-23').after.status).toBe('RUNNING');});
  it.each(['ORDER_HISTORY_ENRICHMENT','ORDER_HISTORY_IMPORT','ADVERTISING_VISITS_IMPORT','DAILY_REPORTS_SYNC'])('waits for the active %s instead of resetting it',async action=>{const f=setup();f.auditLog.findFirst.mockResolvedValue({action,after:{status:'RUNNING'}});await f.service.tick(now);expect(spawn).not.toHaveBeenCalled();expect(f.auditLog.create).not.toHaveBeenCalled();});
  it('waits until catalog synchronization finishes',async()=>{const f=setup();f.jobs.get('daily-sync:2026-10-23').after.status='RUNNING';await f.service.tick(now);expect(spawn).not.toHaveBeenCalled();});
  it('recovers only confirmed dead processes while preserving checkpoints',async()=>{
    const f=setup();f.jobs.delete('daily-sync:2026-10-23');
    f.auditLog.findMany.mockResolvedValue([{id:'old',after:{status:'RUNNING',processId:900001,processed:123,scopeId:'original'}},{id:'active',after:{status:'RUNNING',processId:900002}}]);
    const kill=jest.spyOn(process,'kill').mockImplementation(pid=>{if(pid===900001)throw Object.assign(new Error('gone'),{code:'ESRCH'});return true;});
    try{await f.service.tick(now);expect(f.auditLog.updateMany).toHaveBeenCalledTimes(1);expect(f.auditLog.updateMany.mock.calls[0][0].data.after).toMatchObject({status:'FAILED',processed:123,scopeId:'original'});expect(spawn).not.toHaveBeenCalled();}finally{kill.mockRestore();}
  });
  it('honors disabled schedules and database locking',async()=>{const f=setup();f.jobs.get('daily-sync-config').after.enabled=false;await f.service.tick(now);expect(spawn).not.toHaveBeenCalled();f.jobs.get('daily-sync-config').after.enabled=true;f.tx.$queryRaw.mockResolvedValue([{locked:false}]);await f.service.tick(now);expect(spawn).not.toHaveBeenCalled();});
  it('records a failed worker without losing imported archives or retrying from zero',async()=>{const f=setup();await f.service.tick(now);f.child.emit('exit',1);await Promise.resolve();expect(f.auditLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:'daily-reports:2026-10-23',after:{path:['status'],equals:'RUNNING'}},data:{after:expect.objectContaining({status:'FAILED'})}}));});
});
