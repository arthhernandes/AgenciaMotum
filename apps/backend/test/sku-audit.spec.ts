import { auditSku } from '../src/listing-links/sku-audit';
import { SkuActionsService } from '../src/listing-links/sku-actions.service';

describe('Parent SKU audit without AI',()=>{
  const product={id:'p',variants:[{id:'pv',sku:'10.1',color:'Azul',size:'P',stock:3},{id:'pv2',sku:'10.2',color:'Azul',size:'M',stock:0}]};
  function listing(sku='10.1',size='S/P'){return {id:'l',itemId:'MLB1',status:'active',price:100,availableQuantity:3,links:[],rawData:{attributes:[{id:'SIZE_GRID_ID',value_id:'chart'}]},variants:[{id:'lv',sku,availableQuantity:3,rawData:{attribute_combinations:[{id:'COLOR',value_name:'Azul'},{id:'SIZE',value_name:size}]}}]};}
  it('reports missing variations and treats S/P as P',()=>{const audit=auditSku(product,[listing()]);expect(audit.summary).toMatchObject({variants:2,covered:1,missing:1});expect(audit.alerts.map(a=>a.code)).toEqual(['MISSING']);});
  it('compares the SKU against a saved variation link and warns about stock divergence',()=>{const ad:any=listing('OLD');ad.links=[{listingVariantId:'lv',productVariantId:'pv'}];ad.variants[0].availableQuantity=2;const audit=auditSku(product,[ad]);expect(audit.rows[0].offers[0].sku).toBe('OLD');expect(audit.alerts.map(a=>a.code)).toEqual(expect.arrayContaining(['SKU','STOCK']));});
  it('keeps unknown and absent SKUs visible instead of guessing by color',()=>{const result=auditSku(product,[listing(''),listing('WRONG')]);expect(result.unmatched).toHaveLength(2);expect(result.summary.covered).toBe(0);expect(result.alerts.map(a=>a.code)).toEqual(expect.arrayContaining(['UNMATCHED','NO_SKU']));});
  it('reports multiple active offers as a conference rather than deleting them',()=>{const result=auditSku(product,[listing(),{...listing(),itemId:'MLB2'}]);expect(result.alerts.find(a=>a.code==='MULTIPLE')?.severity).toBe('info');});
});

describe('Durable SKU operation queue',()=>{
  const state={sku:'10',kind:'sku',tasks:[{reference:'MLB1',status:'PENDING',message:''}]};
  function setup(status='PENDING'){
    const after={...state,tasks:[{...state.tasks[0],status}]};
    const prisma:any={auditLog:{findFirst:jest.fn().mockResolvedValue({id:'q1',after}),updateMany:jest.fn().mockResolvedValue({count:1})}};
    return {prisma,service:new SkuActionsService(prisma)};
  }
  it('claims pending work with an optimistic comparison and scopes it by user and account',async()=>{const {service,prisma}=setup();const result=await service.updateQueue('bling1','user1','q1','MLB1','RUNNING','Review');expect(result.tasks[0].status).toBe('RUNNING');expect(prisma.auditLog.findFirst.mock.calls[0][0].where).toMatchObject({entityId:'bling1',userId:'user1'});expect(prisma.auditLog.updateMany.mock.calls[0][0].where.after.equals.tasks[0].status).toBe('PENDING');});
  it('never repeats completed work',async()=>{const {service,prisma}=setup('SUCCESS');await expect(service.updateQueue('a','u','q','MLB1','RUNNING','')).rejects.toThrow('mudou');expect(prisma.auditLog.updateMany).not.toHaveBeenCalled();});
  it('requires manual conference of interrupted work before allowing retry',async()=>{const {service}=setup('RUNNING');await expect(service.updateQueue('a','u','q','MLB1','RUNNING','')).rejects.toThrow();await expect(service.updateQueue('a','u','q','MLB1','REVIEW','')).resolves.toMatchObject({tasks:[{status:'REVIEW'}]});});
  it('rejects competing tabs and does not overwrite their progress',async()=>{const {service,prisma}=setup();prisma.auditLog.updateMany.mockResolvedValue({count:0});await expect(service.updateQueue('a','u','q','MLB1','RUNNING','')).rejects.toThrow('outra janela');});
  it('rejects a queue from a different user/account',async()=>{const {service,prisma}=setup();prisma.auditLog.findFirst.mockResolvedValue(null);await expect(service.updateQueue('other','other','q','MLB1','RUNNING','')).rejects.toThrow('não encontrada');expect(prisma.auditLog.updateMany).not.toHaveBeenCalled();});
});
