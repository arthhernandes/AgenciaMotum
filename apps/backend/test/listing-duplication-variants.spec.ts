import { duplicationVariantOptions, selectDuplicationVariants } from '../src/chat/listing-duplication-variants';
const attrs=(color:string,size:string,sku:string)=>[{id:'COLOR',value_name:color},{id:'CLOTHING_LOT_SIZE',value_name:size},{id:'SELLER_SKU',value_name:sku}];
const modern=(reference:string,color:string,size:string,sku:string)=>({reference,sku,sourceVariationId:null,variations:[],body:{price:100,attributes:attrs(color,size,sku),pictures:[{id:'photo-one'},{id:'photo-two'}]}});
describe('Duplication variation and photo selection',()=>{
 it('includes explicit dimensions, SKU, source MLB and existing photos for each modern offer',()=>{
  expect(duplicationVariantOptions([modern('MLB1','Preto','G','1.1')])[0]).toMatchObject({key:'MLB1',offerKey:'MLB1',reference:'MLB1',sku:'1.1',color:'Preto',size:'G',pictures:[{id:'photo-one'},{id:'photo-two'}]});
 });
 it('selects only black and preserves the approved photo order without modifying the original',()=>{
  const rows=[modern('MLB1','Preto','G','1.1'),modern('MLB2','Branco','M','1.2')],before=structuredClone(rows);
  const selected=selectDuplicationVariants(rows,[{key:'MLB1',photos:['uploaded-photo','photo-one']}]);
  expect(selected).toHaveLength(1);expect(selected[0].body.pictures).toEqual([{id:'uploaded-photo'},{id:'photo-one'}]);expect(selected[0].body.price).toBe(100);expect(rows).toEqual(before);
 });
 it('filters legacy variation bodies, stock sources and the shared photo gallery together',()=>{
  const variants=[{id:10,attributes:attrs('Preto','G','1.1')},{id:20,attributes:attrs('Branco','M','1.2')}];
  const row={reference:'MLB1',variations:variants,body:{attributes:[],pictures:[{id:'old-photo'}],variations:variants.map(v=>({attributes:v.attributes,price:100,available_quantity:3,picture_ids:['old-photo']}))}};
  const options=duplicationVariantOptions([row]);expect(options.map(v=>v.key)).toEqual(['MLB1:10','MLB1:20']);expect(options.map(v=>v.offerKey)).toEqual(['MLB1','MLB1']);
  const [selected]=selectDuplicationVariants([row],[{key:'MLB1:10',photos:['new-photo']}]);
  expect(selected.variations.map((v:any)=>v.id)).toEqual([10]);expect(selected.body.variations).toHaveLength(1);expect(selected.body.variations[0].picture_ids).toEqual(['new-photo']);expect(selected.body.pictures).toEqual([{id:'new-photo'}]);expect(row.body.variations).toHaveLength(2);
 });
 it('rejects empty or foreign selections, duplicate keys and invalid photo references',()=>{
  const rows=[modern('MLB1','Preto','G','1.1')];
  for(const input of [[],[{key:'MLB2'}],[{key:'MLB1'},{key:'MLB1'}],[{key:'MLB1',photos:[]}],[{key:'MLB1',photos:['https://example.com/a.jpg']}],[{key:'MLB1',photos:['photo','photo']}]])expect(()=>selectDuplicationVariants(rows,input)).toThrow();
 });
 it('keeps compatibility for earlier operations without a selection',()=>{const rows=[modern('MLB1','Preto','G','1.1')];expect(selectDuplicationVariants(rows)).toBe(rows);});
});
