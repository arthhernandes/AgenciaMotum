import { AuditIssueType } from '@prisma/client';
import { AuditEngineService } from '../src/audit/audit-engine.service';
function setup(){
 const tx:any={ $queryRaw:jest.fn().mockResolvedValue([{locked:true}]),$executeRaw:jest.fn().mockResolvedValue(1),auditIssue:{findMany:jest.fn().mockResolvedValue([]),createMany:jest.fn(),updateMany:jest.fn(),deleteMany:jest.fn()},productVariant:{findMany:jest.fn().mockResolvedValue([{id:'pv1',productId:'p1',sku:'SKU-1',stock:4,links:[]}])},marketplaceListing:{findMany:jest.fn().mockResolvedValue([])}};
 const prisma:any={$transaction:jest.fn(async callback=>callback(tx))};return {tx,prisma,service:new AuditEngineService(prisma)};
}
describe('Audit engine atomic reconciliation',()=>{
 it('creates an issue for a stocked SKU without an ad',async()=>{const f=setup();expect(await f.service.run()).toMatchObject({active:1,inserted:1});expect(f.tx.auditIssue.createMany).toHaveBeenCalledWith({data:[expect.objectContaining({type:AuditIssueType.NO_LISTING,productVariantId:'pv1'})]});});
 it('reuses the existing issue instead of closing and recreating it',async()=>{const f=setup();f.tx.auditIssue.findMany.mockResolvedValue([{id:'existing',type:AuditIssueType.NO_LISTING,productId:'p1',productVariantId:'pv1',resolved:false,updatedAt:new Date()}]);expect(await f.service.run()).toMatchObject({inserted:0,updated:1,resolved:0});expect(f.tx.auditIssue.createMany).not.toHaveBeenCalled();expect(f.tx.auditIssue.updateMany).not.toHaveBeenCalled();expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);});
 it('preserves open issues when collecting the current state fails',async()=>{const f=setup();f.tx.marketplaceListing.findMany.mockRejectedValue(new Error('read failed'));await expect(f.service.run()).rejects.toThrow('read failed');expect(f.tx.auditIssue.updateMany).not.toHaveBeenCalled();expect(f.tx.auditIssue.createMany).not.toHaveBeenCalled();expect(f.tx.$executeRaw).not.toHaveBeenCalled();});
 it('rejects a simultaneous audit before reading or changing state',async()=>{const f=setup();f.tx.$queryRaw.mockResolvedValue([{locked:false}]);await expect(f.service.run()).rejects.toThrow('andamento');expect(f.tx.productVariant.findMany).not.toHaveBeenCalled();expect(f.tx.auditIssue.updateMany).not.toHaveBeenCalled();});
});
