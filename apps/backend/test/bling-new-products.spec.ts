import { BlingSyncService } from '../src/bling/synchronization/bling-sync.service';
import { SyncType } from '@prisma/client';

describe('Bling new products synchronization',()=>{
 function setup(scope?:{createdFrom:string}){
  const account={id:'bling',accessToken:'private',businessKey:'outlet4u'};
  const db:any={syncExecution:{findFirst:jest.fn().mockResolvedValue(null),findUnique:jest.fn().mockResolvedValue({marketplaceAccountId:'bling',errorDetails:scope?{scope}:{},status:'RUNNING'}),create:jest.fn().mockImplementation(({data}:any)=>Promise.resolve({id:'execution',...data})),update:jest.fn().mockResolvedValue({id:'execution'})},marketplaceAccount:{findFirst:jest.fn().mockResolvedValue(account)},product:{deleteMany:jest.fn()}};
  const matcher:any={run:jest.fn().mockResolvedValue({matched:0})};
  const service=new BlingSyncService(db,{} as any,matcher,{} as any);
  return {service,db,matcher};
 }
 it('uses the Brasilia calendar day even when UTC is already the next day',async()=>{
  jest.useFakeTimers().setSystemTime(new Date('2026-11-11T01:30:00Z'));
  try{const f=setup();const sync=jest.spyOn(f.service,'sync').mockResolvedValue({} as any);await f.service.syncNewToday('bling');expect(sync).toHaveBeenCalledWith(SyncType.INCREMENTAL_SYNC,'bling','2026-11-10 00:00:00');}finally{jest.useRealTimers();}
 });
 it('creates a separate incremental job instead of resuming a full import',async()=>{
  const f=setup();jest.spyOn(f.service,'runExecution').mockResolvedValue(undefined);
  const result=await f.service.sync(SyncType.INCREMENTAL_SYNC,'bling','2026-11-10 00:00:00');
  expect(result.type).toBe('INCREMENTAL_SYNC');expect((result.errorDetails as any).scope.createdFrom).toBe('2026-11-10 00:00:00');
  expect(f.db.syncExecution.findFirst.mock.calls[1][0].where).toMatchObject({type:'INCREMENTAL_SYNC',marketplaceAccountId:'bling',errorDetails:{path:['scope','createdFrom'],equals:'2026-11-10 00:00:00'}});
 });
 it('filters on the provider, imports an alphanumeric parent, and preserves the mode in progress',async()=>{
  const scope={createdFrom:'2026-11-10 00:00:00'};const f=setup(scope);
  const get=jest.spyOn(f.service as any,'get').mockResolvedValue({itens:[{id:1,sku:'KIT5484POLO1',tipoVariacao:'P'}],paginacao:{total:1}});
  const sync=jest.spyOn(f.service as any,'syncBaseProduct').mockResolvedValue(true);
  await f.service.runExecution('execution');
  expect(get).toHaveBeenCalledWith('/produtos','private',{limit:100,offset:0,situacao:'A',dataCriacao:scope.createdFrom});expect(sync).toHaveBeenCalledTimes(1);
 expect(f.db.product.deleteMany).not.toHaveBeenCalled();
  const updates=f.db.syncExecution.update.mock.calls.map((call:any)=>call[0].data);
  expect(updates.filter((data:any)=>data.errorDetails).every((data:any)=>data.errorDetails.scope.createdFrom===scope.createdFrom)).toBe(true);
  expect(updates.at(-1).status).toBe('SUCCESS');
 });
 it('keeps the day restriction and offset when resuming an interrupted new-products run',async()=>{
  const f=setup({createdFrom:'2026-11-10 00:00:00'});
  const get=jest.spyOn(f.service as any,'get').mockResolvedValue({itens:[],paginacao:{total:100}});
  await f.service.runExecution('execution',100);
  expect(get).toHaveBeenCalledWith('/produtos','private',expect.objectContaining({offset:100,dataCriacao:'2026-11-10 00:00:00'}));
 });
 it('retains the day filter after a failed provider request',async()=>{
  const f=setup({createdFrom:'2026-11-10 00:00:00'});jest.spyOn(f.service as any,'get').mockRejectedValue(new Error('Provider unavailable'));
  await f.service.runExecution('execution');
  const data=f.db.syncExecution.update.mock.calls.at(-1)[0].data;
  expect(data.status).toBe('FAILED');expect(data.errorDetails.scope.createdFrom).toBe('2026-11-10 00:00:00');
 });
 it('imports a new variation under an older parent instead of silently skipping it',async()=>{
  const f=setup({createdFrom:'2026-11-10 00:00:00'});
  jest.spyOn(f.service as any,'get').mockResolvedValueOnce({itens:[{id:2,sku:'5484.2',tipoVariacao:'V'}],paginacao:{total:1}}).mockResolvedValueOnce({id:2,produtoPai:{id:1,sku:'5484',descricao:'Polo'}});
  const sync=jest.spyOn(f.service as any,'syncBaseProduct').mockResolvedValue(false);
  await f.service.runExecution('execution');
  expect(sync).toHaveBeenCalledWith('bling','private',{id:1,sku:'5484',descricao:'Polo',tipoVariacao:'P'},new Set([2]));
 });
});
