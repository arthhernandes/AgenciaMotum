import { catalogSearch } from '../src/common/catalog-search';
import { groupListings } from '../src/listings/group-listings';
describe('SKU and MLB search',()=>{
 const listing=(itemId:string,sku:string)=>({id:itemId,itemId,title:'Produto',marketplaceAccountId:'account',variants:[{sku}],rawData:{},price:100,availableQuantity:0,soldQuantity:0});
 it('excludes MLB substrings and neighboring SKUs from a parent SKU search',()=>{const rows=[listing('MLB5358507515','59666.13'),listing('MLB5966626744','31514.1'),listing('MLB2','159666.13'),listing('MLB3','596660.1')];expect(groupListings(rows,{search:'59666'}).map(row=>row.itemId)).toEqual(['MLB5358507515']);});
 it('matches a full MLB independently of SKU',()=>{const rows=[listing('MLB5966626744','31514.1'),listing('MLB2','59666.13')];expect(groupListings(rows,{search:'MLB5966626744'}).map(row=>row.itemId)).toEqual(['MLB5966626744']);});
 it('does not expand a variation SKU into sibling SKUs',()=>{const rows=[listing('MLB1','59666.13'),listing('MLB2','59666.130'),listing('MLB3','59666.1')];expect(groupListings(rows,{search:'SKU: 59666.13'}).map(row=>row.itemId)).toEqual(['MLB1']);});
 it('classifies a numeric code as SKU and keeps title searches',()=>{expect(catalogSearch('59666').kind).toBe('sku');expect(catalogSearch('Polo Marrom').kind).toBe('text');});
 it('excludes unrelated children before grouping and counting a family',()=>{const wanted={...listing('MLB1','59666.13'),rawData:{family_id:'family'}};const unrelated={...listing('MLB5966626744','31526'),rawData:{family_id:'family'}};const result=groupListings([wanted,unrelated],{search:'59666'});expect(result).toHaveLength(1);expect(result[0].children.map((child:any)=>child.itemId)).toEqual(['MLB1']);expect(result[0].variants.map((variant:any)=>variant.sku)).toEqual(['59666.13']);});
});
