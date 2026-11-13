import { reportFamilies } from '../src/reports/report-families';
import { groupListings } from '../src/listings/group-listings';
describe('Report product families',()=>{
 it('counts one parent per marketplace family and one per legacy listing with native variations',()=>{
  const rows=reportFamilies(groupListings([item('MLB1','5484.1',22),item('MLB2','5484.2',22),item('MLB3','5484.3',33),{...item('MLB4','5484.4'),variants:[{sku:'5484.4'},{sku:'5484.5'}]}]),[product('5484',['5484.1','5484.2','5484.3','5484.4','5484.5'])],'outlet4u');
  expect(rows).toHaveLength(1);expect(rows[0].parentCount).toBe(3);expect(rows[0].children).toHaveLength(4);expect(rows[0].soldQuantity).toBe(12);
 });
 const item=(id:string,sku:string,family?:number,status='active'):any=>({id,itemId:id,marketplaceAccountId:'meli',title:id,status,availableQuantity:2,soldQuantity:3,price:100,variants:[],links:[],rawData:{family_id:family,attributes:[{id:'SELLER_SKU',value_name:sku}]}});
 const product=(sku:string,variants:string[]):any=>({id:sku,sku,title:'Produto '+sku,variants:variants.map(sku=>({sku}))});
 it('joins isolated MLBs and different marketplace families of the same Bling parent',()=>{
  const groups=groupListings([item('MLB1','5484.1'),item('MLB2','5484.2',22,'paused'),item('MLB3','5484.3',33)]);
  const rows=reportFamilies(groups,[product('5484',['5484.1','5484.2','5484.3'])],'outlet4u');
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({baseSku:'5484',title:'Produto 5484',availableQuantity:6,soldQuantity:9,status:'mixed'});
  expect(rows[0].children.map((c:any)=>c.itemId)).toEqual(['MLB1','MLB2','MLB3']);
 });
 it('consolidates Bling grid lines of the same parent family',()=>{
  const rows=reportFamilies(groupListings([item('MLB1','5484.1'),item('MLB2','5484.2')]),[product('5484-LINHA1',['5484.1']),product('5484-LINHA2',['5484.2'])],'mottum');
  expect(rows.map(r=>r.baseSku)).toEqual(['5484']);expect(rows[0].children).toHaveLength(2);
 });
 it('does not combine unrelated listings by similar titles or missing SKUs',()=>{
  expect(reportFamilies(groupListings([item('MLB1',''),item('MLB2','')]),[],'mottum')).toHaveLength(2);
 });
 it('does not merge a marketplace family spanning two distinct catalog products',()=>{
  const rows=reportFamilies(groupListings([item('MLB1','1.1',10),item('MLB2','2.1',10),item('MLB3','1.2')]),[product('1',['1.1','1.2']),product('2',['2.1'])],'mottum');
  expect(rows).toHaveLength(2);expect(rows[0].baseSku).toBeNull();
 });
});
