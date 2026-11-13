import {consolidateCatalogParents} from '../src/bling/synchronization/consolidate-catalog-parents';
describe('Consolidating fragmented parent grades',()=>{
 function setup(){
  const rows:any[]=[{id:'parent',sku:'58447',blingProductId:'root',title:'KIT 2 CUECAS',variants:[{id:'v1',sku:'58447.1'},{id:'v2',sku:'58447.2'}]},{id:'fragment',sku:'58447',blingProductId:'other',title:'KIT 2 CUECAS ',variants:[{id:'v3',sku:'58447.3'}]},{id:'shell',sku:'58447',blingProductId:'shell',title:'KIT 2 CUECAS',variants:[{id:'v0',sku:'58447'}]}];
  const tx:any={productVariant:{updateMany:jest.fn()},listingProductLink:{updateMany:jest.fn()},auditIssue:{updateMany:jest.fn()},auditLog:{create:jest.fn()}};
  const prisma:any={product:{findMany:jest.fn().mockResolvedValue(rows)},$transaction:jest.fn(async callback=>callback(tx))};return {rows,tx,prisma};
 }
 it('moves all real grade fragments, preserving references and links, without moving the isolated base SKU',async()=>{
  const f=setup();expect(await consolidateCatalogParents(f.prisma,'account')).toBe(1);
  expect(f.prisma.product.findMany.mock.calls[0][0].where).toEqual({blingAccountId:'account'});
  expect(f.tx.productVariant.updateMany).toHaveBeenCalledWith({where:{blingAccountId:'account',productId:{in:['fragment']},sku:{not:'58447'}},data:{productId:'parent'}});
  expect(f.tx.listingProductLink.updateMany).toHaveBeenCalledWith({where:{productId:{in:['fragment']}},data:{productId:'parent'}});
  expect(f.tx.auditLog.create).toHaveBeenCalled();
 });
 it('groups the same SKU even when imported titles differ',async()=>{const f=setup();f.rows[1].title='OTHER';expect(await consolidateCatalogParents(f.prisma,'account')).toBe(1);});
 it('preserves base links as parent links without adding a fake variation',async()=>{const f=setup();f.rows.splice(1,1);f.rows[1]._count={links:1};f.tx.listingProductLink.findMany=jest.fn().mockResolvedValue([{id:'link'}]);expect(await consolidateCatalogParents(f.prisma,'account')).toBe(1);expect(f.tx.listingProductLink.updateMany).toHaveBeenCalledWith({where:{productVariantId:{in:['v0']}},data:{productId:'parent',productVariantId:null}});});
 it('does not consolidate a grade with only a parent placeholder',async()=>{const f=setup();f.rows.splice(1,1);expect(await consolidateCatalogParents(f.prisma,'account')).toBe(0);});
});
