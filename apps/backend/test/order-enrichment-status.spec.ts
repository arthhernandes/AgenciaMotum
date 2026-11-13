import { ProfitabilityService } from '../src/reports/profitability.service';
import { assertRoutePermissions } from '../src/auth/permissions';

describe('Temporary order enrichment status',()=>{
  it('exposes progress without process identifiers, raw errors or financial inputs',async()=>{
    const prisma:any={auditLog:{findFirst:jest.fn().mockResolvedValue({id:'job',createdAt:new Date('2026-10-23T13:55:00Z'),after:{status:'RUNNING',processId:123,issues:[{message:'private details'}],accounts:[{account:'Loja A',total:100,processed:25,updated:20,shippingFilled:20,fiscalFilled:3,failed:0},{account:'Loja B',total:100,processed:75,shippingFilled:60}]}})}};
    const result=await new ProfitabilityService(prisma,{} as any).enrichmentStatus();
    expect(result).toMatchObject({status:'RUNNING',total:200,processed:100,percent:50,accounts:[{account:'Loja A',processed:25},{account:'Loja B',processed:75}]});
    expect(JSON.stringify(result)).not.toMatch(/private details|processId/);
  });
  it('handles no import and empty startup progress',async()=>{
    const findFirst=jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({id:'job',createdAt:new Date(),after:{status:'RUNNING',accounts:[]}});
    const service=new ProfitabilityService({auditLog:{findFirst}} as any,{} as any);
    expect(await service.enrichmentStatus()).toEqual({status:'NOT_STARTED',accounts:[]});
    expect(await service.enrichmentStatus()).toMatchObject({status:'RUNNING',percent:0,total:0});
  });
  it('requires reports and product cost permissions',()=>{
    expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['reports.view']},'GET','/api/reports/profitability/enrichment-status')).toThrow();
    expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['reports.view','costs.view']},'GET','/api/reports/profitability/enrichment-status')).not.toThrow();
  });
});
