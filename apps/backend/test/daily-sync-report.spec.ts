import {DailySyncService} from '../src/jobs/daily-sync.service';
describe('Daily synchronization reports',()=>{
 it('scopes steps to the selected business and includes metrics and safe error details',async()=>{
  const prisma:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({businessKey:'mottum'})},auditLog:{findMany:jest.fn().mockResolvedValue([{id:'run',after:{day:'2026-10-21',steps:[{accountId:'o',business:'mottum',source:'BLING',status:'FAILED',executionId:'execution'},{accountId:'other',business:'outlet4u',source:'BLING',status:'SUCCESS',executionId:'private'}]}}])},syncExecution:{findMany:jest.fn().mockResolvedValue([{id:'execution',status:'PARTIAL',itemsProcessed:100,itemsCreated:2,itemsUpdated:8,errors:2,errorDetails:{errors:[{sku:'SKU1',message:'Estoque indisponível'},{message:'access_token private-value'}]}}])}};
  const rows=await new DailySyncService(prisma,{} as any,{} as any).reports('bling');
  expect(rows[0]).toMatchObject({processed:100,errors:2,status:'PARTIAL'});expect(rows[0].steps).toHaveLength(1);
  expect(rows[0].steps[0].errorMessages[0]).toEqual({reference:'SKU1',message:'Estoque indisponível'});
  expect(JSON.stringify(rows)).not.toContain('private-value');
  expect(prisma.syncExecution.findMany.mock.calls[0][0].where).toEqual({id:{in:['execution']},marketplaceAccount:{businessKey:'mottum'}});
 });
 it('rejects an unknown account instead of returning all reports',async()=>{
  const prisma:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue(null)}};
  await expect(new DailySyncService(prisma,{} as any,{} as any).reports('unknown')).rejects.toThrow('Selecione');
 });
 it('returns no reports before the first daily run',async()=>{
  const prisma:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({businessKey:'mottum'})},auditLog:{findMany:jest.fn().mockResolvedValue([])},syncExecution:{findMany:jest.fn().mockResolvedValue([])}};
  expect(await new DailySyncService(prisma,{} as any,{} as any).reports('bling')).toEqual([]);
 });
});
