import { publicationBatchIndices } from '../src/chat/variation-batches';
import { ChatMarketplaceService } from '../src/chat/chat-marketplace.service';

describe('Live family registration versus sale offers',()=>{
  function setup(){
    const blue={id:'MLB1',seller_id:123,user_product_id:'UP_BLUE',status:'active',available_quantity:5,price:249.9,attributes:[{id:'SELLER_SKU',value_name:'BLUE'},{id:'COLOR',value_name:'Azul Royal'},{id:'SIZE',value_name:'G'}]};
    const client={searchUserProductOffers:jest.fn().mockImplementation(async(_token,_seller,up)=>up==='UP_BLUE'?['MLB1']:[]),getItem:jest.fn().mockResolvedValue(blue)};
    const service=new ChatMarketplaceService({} as never,{} as never,client as never);
    jest.spyOn(service as any,'resolveFamily').mockResolvedValue({id:'family',title:'Polo',children:[{itemId:'MLB1'}]});
    jest.spyOn(service as any,'target').mockResolvedValue({account:{id:'seller',sellerId:'123'},token:'token',item:blue});
    jest.spyOn((service as any).familyVariants,'inspect').mockResolvedValue({products:[{id:'UP_BLUE',attributes:[{id:'COLOR',values:[{name:'Azul Royal'}]},{id:'SIZE',values:[{name:'G'}]}]},{id:'UP_YELLOW',attributes:[{id:'COLOR',values:[{name:'Amarelo'}]},{id:'SIZE',values:[{name:'G'}]}]}]});
    return {service,client};
  }
  it('checks offers even for family records absent from synchronized listings',async()=>{
    const {service,client}=setup();const result=await service.familyItems({id:'bling',businessKey:'mottum'},'Polo');
    expect(client.searchUserProductOffers).toHaveBeenCalledWith('token','123','UP_YELLOW');
    expect(result.variantesDaFamilia?.find(v=>v.id==='UP_YELLOW')?.ofertas).toEqual([]);
    expect(result.variantesDaFamilia?.find(v=>v.id==='UP_BLUE')?.ofertas).toEqual([{mlb:'MLB1',status:'active',estoque:5}]);
  });
  it('does not claim a variant is unpublished when live offer verification fails',async()=>{
    const {service,client}=setup();client.searchUserProductOffers.mockRejectedValue(new Error('network failure'));
    await expect(service.familyItems({id:'bling',businessKey:'mottum'},'Polo')).rejects.toThrow('network failure');
  });
});

describe('Publication batch scheduling',()=>{
 it('processes a complete 48-row selection as 20, 20 and 8 without revisiting verified rows',()=>{
  const rows=Array.from({length:48},()=>({status:'QUEUED'}));const counts=[];
  for(let n=0;n<3;n++){const indices=publicationBatchIndices(rows);counts.push(indices.length);for(const index of indices)rows[index].status='ACTIVE';}
  expect(counts).toEqual([20,20,8]);expect(publicationBatchIndices(rows)).toEqual([]);
 });
 it('does not let already published zero-stock offers starve the remaining selection',()=>{
  const rows=Array.from({length:48},(_,index)=>({status:index<20?'PUBLISHED_NO_STOCK':'QUEUED'}));
  expect(publicationBatchIndices(rows)).toEqual(Array.from({length:20},(_,i)=>i+20));
 });
});
