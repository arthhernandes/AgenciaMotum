import { ProductCostsService } from '../src/products/product-costs.service';
import { BlingSyncService } from '../src/bling/synchronization/bling-sync.service';

describe('Bling costs shown on the links map',()=>{
  function setup(){
    const product={id:'p1',sku:'59666',blingProductId:'123',variants:[{sku:'59666.1'}]};
    const prisma:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'bling1'})},product:{findFirst:jest.fn().mockResolvedValue(product)},auditLog:{findFirst:jest.fn().mockResolvedValue(null),upsert:jest.fn().mockResolvedValue({})}};
    const bling:any={productCostsForParent:jest.fn().mockResolvedValue([{sku:'59666.1',cost:12.5,checkedAt:new Date().toISOString(),stale:false}])};
    return {prisma,bling,product,service:new ProductCostsService(prisma,bling)};
  }
  it('fetches and persists costs only for the selected account and parent',async()=>{const {service,prisma,bling}=setup();const result=await service.find('bling1','p1');expect(result.rows[0].cost).toBe(12.5);expect(bling.productCostsForParent).toHaveBeenCalledWith('bling1','123','59666',['59666.1']);expect(prisma.product.findFirst.mock.calls[0][0].where).toEqual({id:'p1',blingAccountId:'bling1'});expect(prisma.auditLog.upsert.mock.calls[0][0].create.after.accountId).toBe('bling1');});
  it('refuses another account product before making external calls',async()=>{const {service,prisma,bling}=setup();prisma.product.findFirst.mockResolvedValue(null);await expect(service.find('wrong','p1')).rejects.toThrow('nesta conta');expect(bling.productCostsForParent).not.toHaveBeenCalled();});
  it('reuses a recent complete snapshot and refreshes when requested',async()=>{const {service,prisma,bling}=setup();prisma.auditLog.findFirst.mockResolvedValue({after:{checkedAt:new Date().toISOString(),rows:[{sku:'59666.1',cost:0}]}});expect((await service.find('bling1','p1')).rows[0].cost).toBe(0);expect(bling.productCostsForParent).not.toHaveBeenCalled();await service.find('bling1','p1',true);expect(bling.productCostsForParent).toHaveBeenCalledTimes(1);});
  it('does not reuse a snapshot whose SKU grade changed',async()=>{const {service,prisma,bling}=setup();prisma.auditLog.findFirst.mockResolvedValue({after:{checkedAt:new Date().toISOString(),rows:[{sku:'other',cost:99}]}});await service.find('bling1','p1');expect(bling.productCostsForParent).toHaveBeenCalledTimes(1);});
  it('keeps previous costs visibly stale on an API failure instead of fabricating zero',async()=>{const {service,prisma,bling}=setup();prisma.auditLog.findFirst.mockResolvedValue({after:{rows:[{sku:'59666.1',cost:8,checkedAt:'2026-10-01T00:00:00Z'}]}});bling.productCostsForParent.mockRejectedValue(new Error('offline'));const result=await service.find('bling1','p1',true);expect(result.rows[0]).toMatchObject({cost:8,stale:true,checkedAt:'2026-10-01T00:00:00Z'});});
  it('shows an unavailable cost on initial failure',async()=>{const {service,bling}=setup();bling.productCostsForParent.mockRejectedValue(new Error('offline'));expect((await service.find('bling1','p1')).rows[0]).toMatchObject({cost:null,stale:true});});
});

describe('Bling cost values and grade identity',()=>{
  function setup(detail:any){const prisma:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'a',accessToken:'private'})}};const service=new BlingSyncService(prisma,{} as any,{} as any,{} as any);jest.spyOn(service as any,'get').mockResolvedValue(detail);return {service};}
  it('reads every variant from one parent response and never substitutes sale price for cost',async()=>{const {service}=setup({sku:'59666',precos:{precoCusto:100},variacoes:[{sku:'59666.1',precos:{preco:45,precoCusto:0}},{sku:'59666.2',precos:{preco:45,precoCusto:12.5}},{sku:'59666.3',precos:{preco:45}}]});const rows=await service.productCostsForParent('a','123','59666',['59666.1','59666.2','59666.3']);expect(rows.map(row=>row.cost)).toEqual([0,12.5,null]);expect((service as any).get).toHaveBeenCalledTimes(1);});
  it('rejects a mismatched parent instead of attaching another product costs',async()=>{const {service}=setup({sku:'OTHER'});await expect(service.productCostsForParent('a','123','59666',['59666.1'])).rejects.toThrow('pai diferente');});
  it('does not guess a missing variant cost from the parent or another SKU',async()=>{const {service}=setup({sku:'59666',variacoes:[{sku:'59666.2',precos:{precoCusto:90}}]});expect((await service.productCostsForParent('a','123','59666',['59666.1']))[0]).toMatchObject({sku:'59666.1',cost:null,stale:true});});
});
