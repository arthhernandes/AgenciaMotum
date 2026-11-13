import {ChatMarketplaceService} from '../src/chat/chat-marketplace.service';

describe('correct inconsistent brand/model on existing moderated offers',()=>{
 const attributes=[{id:'BRAND',value_name:'Genérica'},{id:'MODEL',value_name:'Old'},{id:'COLOR',value_name:'Branco'},{id:'SIZE',value_name:'M'}];
 const service=()=>new ChatMarketplaceService({} as any,{} as any,{} as any);
 const correction={attributes:[{id:'BRAND',value_name:'Ralph Lauren'},{id:'MODEL',value_name:'Reference'},...attributes.slice(2)]};
 it.each(['inactive','under_review'])('permits a reviewed identity correction in %s waiting_for_patch',async status=>{
  await expect((service() as any).restrictions({id:'MLB1',status,sub_status:['waiting_for_patch'],attributes},{},'token',correction)).resolves.toBeUndefined();
 });
 it('does not allow changing price, stock, status, SKU or size through this exception',async()=>{
  const item={id:'MLB1',status:'inactive',sub_status:['waiting_for_patch'],attributes};
  for(const body of [{...correction,price:100},{...correction,available_quantity:10},{...correction,status:'active'},{attributes:[...correction.attributes,{id:'SELLER_SKU',value_name:'new'}]},{attributes:correction.attributes.map(a=>a.id==='SIZE'?{...a,value_name:'G'}:a)}]){
   await expect((service() as any).restrictions(item,{},'token',body)).rejects.toThrow('correção pendente');
  }
 });
 it.each([['inactive',[]],['closed',['waiting_for_patch']],['under_review',['forbidden']]])('keeps other inactive or restricted states protected: %s',async(status,sub_status)=>{
  await expect((service() as any).restrictions({id:'MLB1',status,sub_status,attributes},{},'token',correction)).rejects.toThrow();
 });
 it('reports a provider attribute lock without claiming the correction was applied',()=>{
  const result=(service() as any).providerError({response:{status:400,data:{cause:[{code:'item.attributes.not_modifiable'}]}}});
  expect(result.message).toContain('correção não foi aplicada');expect(result.message).toContain('revisão');
 });
});
