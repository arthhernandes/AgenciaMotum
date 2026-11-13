import {MercadoLivreSyncService} from '../src/mercadolivre/synchronization/mercadolivre-sync.service';

describe('reconcile listings omitted from seller search',()=>{
 function setup(){
  const prisma:any={syncExecution:{create:jest.fn().mockResolvedValue({id:'execution'}),update:jest.fn()},marketplaceAccount:{findUniqueOrThrow:jest.fn().mockResolvedValue({sellerId:'123'})},marketplaceListing:{findMany:jest.fn().mockResolvedValue([{itemId:'MLB2'}]),upsert:jest.fn().mockResolvedValue({id:'listing'})}};
  const client:any={searchSellerItems:jest.fn().mockResolvedValue({results:['MLB1'],paging:{total:1}}),getItems:jest.fn().mockResolvedValueOnce([{code:200,body:{id:'MLB1',seller_id:123,status:'active'}}]).mockResolvedValueOnce([{code:200,body:{id:'MLB2',seller_id:123,status:'closed',sub_status:['deleted']}}])};
  const service=new MercadoLivreSyncService(prisma,{getValidAccessToken:jest.fn().mockResolvedValue('token')} as any,client,{run:jest.fn()} as any,{run:jest.fn()} as any);
  return {service,prisma,client};
 }
 it('refreshes a deleted listing that no longer appears in search on a full sync',async()=>{
  const f=setup();const result=await f.service.syncAccount('account');
  expect(result.errors).toEqual([]);expect(result.processed).toBe(2);
  expect(f.prisma.marketplaceListing.findMany).toHaveBeenCalledWith({where:{marketplaceAccountId:'account',status:{not:'closed'},itemId:{notIn:['MLB1']}},select:{itemId:true}});
  expect(f.prisma.marketplaceListing.upsert.mock.calls[1][0].update).toMatchObject({status:'closed',rawData:{sub_status:['deleted']}});
 });
 it.each([403,404,502])('does not infer deletion from a failed read (%s)',async code=>{
  const f=setup();f.client.getItems.mockReset().mockResolvedValueOnce([{code:200,body:{id:'MLB1'}}]).mockResolvedValueOnce([{code,body:{id:'MLB2'}}]);
  const result=await f.service.syncAccount('account');expect(result.errors).toHaveLength(1);expect(f.prisma.marketplaceListing.upsert).toHaveBeenCalledTimes(1);
 });
 it('does not import a different seller or response ID into this account',async()=>{
  for(const body of [{id:'MLB2',seller_id:999},{id:'MLB99',seller_id:123}]){
   const f=setup();f.client.getItems.mockReset().mockResolvedValueOnce([{code:200,body:{id:'MLB1'}}]).mockResolvedValueOnce([{code:200,body}]);
   const result=await f.service.syncAccount('account');expect(result.errors).toHaveLength(1);expect(f.prisma.marketplaceListing.upsert).toHaveBeenCalledTimes(1);
  }
 });
 it('does not reconcile omissions during a deliberately limited import',async()=>{
  const f=setup();await f.service.syncAccount('account',undefined,5);expect(f.prisma.marketplaceListing.findMany).not.toHaveBeenCalled();
 });
});
