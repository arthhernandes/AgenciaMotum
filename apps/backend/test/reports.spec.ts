import { ReportsService } from '../src/reports/reports.module';
import { assertRoutePermissions } from '../src/auth/permissions';
describe('Account reports',()=>{
  function setup(){
    const item:any={id:'one',itemId:'MLB1',marketplaceAccountId:'meli',title:'Boné',price:100,availableQuantity:4,soldQuantity:9,status:'active',rawData:{family_id:1},variants:[],links:[]};
    const listings:any={findAll:jest.fn().mockResolvedValue({data:[item,{...item,id:'two',itemId:'MLB2',status:'inactive',rawData:{family_id:1,sub_status:['deleted']}}]})};
    const prisma:any={product:{findMany:jest.fn().mockResolvedValue([])},marketplaceAccount:{findMany:jest.fn().mockResolvedValue([{id:'bling'}]),findFirst:jest.fn().mockResolvedValue({id:'bling',businessKey:'outlet4u'})},syncExecution:{findMany:jest.fn().mockResolvedValue([]),aggregate:jest.fn().mockResolvedValue({_count:2,_sum:{itemsProcessed:50,errors:1}}),groupBy:jest.fn().mockResolvedValue([{status:'SUCCESS',_count:1},{status:'PARTIAL',_count:1}])}};
    return {prisma,listings,service:new ReportsService(prisma,listings)};
  }
  it('scopes the catalog to the selected account without querying synchronization history',async()=>{
    const {service,prisma,listings}=setup();const report=await service.overview({marketplaceAccountId:'bling',dateFrom:'2026-10-01',dateTo:'2026-10-02'});
    expect(listings.findAll).toHaveBeenCalledWith({page:1,limit:50,marketplaceAccountId:'bling'},true);
    expect(prisma.marketplaceAccount.findMany).toHaveBeenCalledWith({where:{businessKey:'outlet4u',marketplace:'BLING'},select:{id:true}});
    expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({blingAccountId:{in:['bling']}});
    for(const method of ['findMany','aggregate','groupBy'])expect(prisma.syncExecution[method]).not.toHaveBeenCalled();
    expect(report.listings.summary).toMatchObject({offers:1,families:1,units:4,sold:9,statuses:{active:1}});
    expect(report.listings.rows[0].itemIds).toEqual(['MLB1']);expect(report).not.toHaveProperty('sync');
    expect(JSON.stringify(report)).not.toContain('rawData');
  });
  it('does not allow missing or invalid accounts to query global reports',async()=>{const {service,prisma,listings}=setup();prisma.marketplaceAccount.findFirst.mockResolvedValue(null);await expect(service.overview({marketplaceAccountId:'unknown'})).rejects.toThrow();expect(listings.findAll).not.toHaveBeenCalled();expect(prisma.syncExecution.findMany).not.toHaveBeenCalled();});
  it('rejects invalid or reversed synchronization periods',async()=>{const {service,listings}=setup();for(const [dateFrom,dateTo] of [['2026-02-30','2026-03-01'],['2026-10-03','2026-10-01']])await expect(service.overview({marketplaceAccountId:'bling',dateFrom,dateTo})).rejects.toThrow();expect(listings.findAll).not.toHaveBeenCalled();});
  it('grants read-only reporting independently without granting writes or user management',()=>{
    const user={role:'VIEWER',permissions:['reports.view']};
    expect(()=>assertRoutePermissions(user,'GET','/api/reports')).not.toThrow();expect(()=>assertRoutePermissions(user,'POST','/api/listings/visits')).not.toThrow();
    for(const [method,path] of [['POST','/api/reports'],['POST','/api/sync/bling'],['GET','/api/users'],['POST','/api/chat/listing-editor/prepare']])expect(()=>assertRoutePermissions(user,method,path)).toThrow();
    expect(()=>assertRoutePermissions({role:'VIEWER',permissions:[]},'GET','/api/reports')).toThrow();
  });
});
