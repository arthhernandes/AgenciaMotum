import { listingSkuState } from '../src/listings/sku-catalog-match';
import { groupListings } from '../src/listings/group-listings';

describe('SKU catalog filter', () => {
  it('matches SELLER_SKU rather than a manual link or seller_custom_field', () => {
    const listing = { rawData: { seller_custom_field: 'WRONG', attributes: [{id:'SELLER_SKU',value_name:'59666.1'}] }, links: [{}] };
    expect(listingSkuState(listing, new Set(['59666.1']))).toEqual({foundSkuCount:1,missingSkuCount:0,absentSkuCount:0});
    expect(listingSkuState(listing, new Set())).toEqual({foundSkuCount:0,missingSkuCount:1,absentSkuCount:0});
  });
  it('distinguishes missing catalog SKUs from absent listing SKUs', () => {
    expect(listingSkuState({variants:[{sku:'123.1'},{sku:null}]},new Set())).toEqual({foundSkuCount:0,missingSkuCount:1,absentSkuCount:1});
  });
  it('retains the parent and all siblings when one variation has an unmatched SKU', () => {
    const base = {marketplaceAccountId:'mottum',rawData:{family_id:1},price:10,availableQuantity:1,soldQuantity:0};
    const groups = groupListings([{...base,itemId:'MLB1',missingSkuCount:1},{...base,itemId:'MLB2',foundSkuCount:1}],{skuMatch:'missing'});
    expect(groups).toHaveLength(1);
    expect(groups[0].children).toHaveLength(2);
    expect(groupListings([{...base,itemId:'MLB2',foundSkuCount:1}],{skuMatch:'missing'})).toHaveLength(0);
  });
  function group(skus:Array<string|null>,links:any[]=[]){
    const catalog=new Set(['10.1','10.2']);
    const listings=skus.map((sku,index)=>{const row:any={id:String(index),itemId:'MLB'+index,marketplaceAccountId:'ml',price:10,availableQuantity:1,soldQuantity:0,rawData:{family_id:1,...(sku?{attributes:[{id:'SELLER_SKU',value_name:sku}]}:{})},links};return {...row,...listingSkuState(row,catalog)};});
    return listings;
  }
  it('only labels a family COM SKU when every offer has a SKU in the Bling catalog',()=>{
    const result=groupListings(group(['10.1','10.2']));expect(result[0]).toMatchObject({skuStatus:'found',foundSkuCount:2,missingSkuCount:0,absentSkuCount:0});
  });
  it('does not use saved links as proof that seller SKUs belong to Bling',()=>{
    expect(groupListings(group(['WRONG'],[{}]))[0].skuStatus).toBe('missing');
    expect(groupListings(group([null],[{}]))[0].skuStatus).toBe('no_sku');
    expect(groupListings(group(['10.1']))[0].skuStatus).toBe('found');
  });
  it('shows partial families without hiding missing siblings and filters them independently',()=>{
    const listings=group(['10.1','WRONG',null]);
    expect(groupListings(listings)[0]).toMatchObject({skuStatus:'partial',foundSkuCount:1,missingSkuCount:1,absentSkuCount:1});
    expect(groupListings(listings,{skuMatch:'found'})).toHaveLength(0);
    expect(groupListings(listings,{skuMatch:'partial'})[0].children).toHaveLength(3);
  });
});
