import { applySharedStock } from '../src/bling/synchronization/shared-stock';
describe('Independent store stock',()=>{
 it('keeps each store stock without looking up any other store',async()=>{const records=[{blingAccountId:'a',sku:'SKU',stock:1},{blingAccountId:'b',sku:'SKU',stock:9}];expect(await applySharedStock({} as any,records)).toEqual(records);expect(records.map(row=>row.stock)).toEqual([1,9]);});
});
