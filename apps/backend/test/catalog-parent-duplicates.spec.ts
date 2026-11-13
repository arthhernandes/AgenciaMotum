import {parentPlaceholderIds} from '../src/products/catalog-parent-duplicates';
describe('Catalog parent placeholders',()=>{
 const shell:any={id:'shell',blingAccountId:'bling',sku:'60346',_count:{links:0},variants:[{sku:'60346',color:null,size:null,_count:{links:0}}]};
 const grade:any={id:'grade',blingAccountId:'bling',sku:'60346',_count:{links:0},variants:[{sku:'60346.1',color:'Preto',size:'P',_count:{links:1}}]};
 it('hides only the isolated parent beside the full grade',()=>expect(parentPlaceholderIds([shell,grade])).toEqual(['shell']));
 it('keeps a simple product without a duplicate grade',()=>expect(parentPlaceholderIds([shell])).toEqual([]));
 it('keeps products from different accounts separate',()=>expect(parentPlaceholderIds([shell,{...grade,blingAccountId:'other'}])).toEqual([]));
 it('keeps a directly linked parent',()=>expect(parentPlaceholderIds([{...shell,_count:{links:1}},grade])).toEqual([]));
 it('keeps a parent whose simple SKU has a link',()=>expect(parentPlaceholderIds([{...shell,variants:[{...shell.variants[0],_count:{links:1}}]},grade])).toEqual([]));
});
