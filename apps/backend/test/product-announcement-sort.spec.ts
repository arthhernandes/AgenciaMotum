import {productAnnouncementCount,sortProductsByAnnouncements} from '../src/products/sort-products';
describe('Product sorting by announcement families',()=>{
 const link=(account:string,family:number,item:string)=>({listing:{marketplaceAccountId:account,itemId:item,rawData:{family_id:family}}});
 it('counts a family only once across parent and variation links, keeping accounts separate',()=>{
  expect(productAnnouncementCount({links:[link('a',1,'MLB1')],variants:[{links:[link('a',1,'MLB2'),link('b',1,'MLB3')]}]})).toBe(2);
 });
 it('orders all candidates before pagination and keeps stable ties',()=>{
  const rows=[{id:'none',sku:'3',links:[]},{id:'one',sku:'2',links:[link('a',1,'MLB1')]},{id:'many',sku:'1',links:[link('a',2,'MLB2'),link('a',3,'MLB3')]}];
  expect(sortProductsByAnnouncements(rows,'desc').map(row=>row.id)).toEqual(['many','one','none']);
  expect(sortProductsByAnnouncements(rows,'asc').map(row=>row.id)).toEqual(['none','one','many']);
  expect(rows[0].id).toBe('none');
 });
});
