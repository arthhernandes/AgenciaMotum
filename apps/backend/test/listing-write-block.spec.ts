import {assertListingWritable,FINALIZED_MESSAGE} from '../src/listings/listing-write-block';
import {MercadoLivreClient} from '../src/mercadolivre/mercadolivre.client';
import {groupListings} from '../src/listings/group-listings';
import {throwError} from 'rxjs';
describe('finalized listing interaction blocks',()=>{
 it('keeps family actions enabled when another offer is writable while preserving the closed offer status',()=>{
  const base={marketplaceAccountId:'account',rawData:{family_id:456},variants:[],links:[],price:100,availableQuantity:1,soldQuantity:0};
  const group=groupListings([{...base,id:'closed',itemId:'MLB1',status:'closed'},{...base,id:'active',itemId:'MLB2',status:'active'}])[0];
  expect(group).toMatchObject({interactionBlocked:false,blockedCount:1,finalized:false});expect(group.variants.find((row:any)=>row.itemId==='MLB1')?.status).toBe('closed');
 });
 const prisma=()=>({marketplaceAccount:{findMany:jest.fn().mockResolvedValue([{id:'account'}])},integrationSnapshot:{findFirst:jest.fn().mockResolvedValue({payload:{code:'seller.optin.fake'}})},marketplaceListing:{findMany:jest.fn().mockResolvedValue([])}});
 it('blocks closed items without depending on the publication restriction cache',async()=>{
  const db=prisma();await expect(assertListingWritable(db,'account',{id:'MLB1',status:'closed'})).rejects.toThrow(FINALIZED_MESSAGE);expect(db.integrationSnapshot.findFirst).not.toHaveBeenCalled();
 });
 it.each([false,true])('recognizes Mercado Livre finalized moderation in raw or direct snapshots (%s)',cached=>{
  const item={status:'under_review',...(cached?{rawData:{sub_status:['forbidden']}}:{sub_status:['forbidden']})};
  const listing={...item,id:'1',itemId:'MLB6908603408',marketplaceAccountId:'account',rawData:{...(item as any).rawData,family_id:1106679484294227,sub_status:['forbidden']},variants:[],links:[],price:100,availableQuantity:0,soldQuantity:0};
  expect(groupListings([listing])[0]).toMatchObject({finalized:true,status:'closed',interactionBlocked:true});
 });
 it.each(['updateItem','createUserProductOffer','updateUserProductFamily'])('blocks %s before any remote write',async(method)=>{
  const db=prisma(),http:any={put:jest.fn(),post:jest.fn()},client=new MercadoLivreClient(http,db as any);
  jest.spyOn(client,'getItem').mockResolvedValue({id:'MLB1',seller_id:123,user_product_id:'UP1',family_id:456,status:'under_review'});
  jest.spyOn(client,'getUserProduct').mockResolvedValue({id:'UP1',user_id:123,family_id:456});
  jest.spyOn(client,'getUserProductFamily').mockResolvedValue({user_id:123,family_id:456});
  await expect((client as any)[method]('token',method==='updateItem'?'MLB1':method==='createUserProductOffer'?'UP1':'456',{})).rejects.toThrow(FINALIZED_MESSAGE);
  expect(http.put).not.toHaveBeenCalled();expect(http.post).not.toHaveBeenCalled();
 });
 it('marks the family finalized and blocks actions even when provider still reports under_review',()=>{
  const row={id:'1',itemId:'MLB1',marketplaceAccountId:'account',status:'under_review',interactionBlocked:true,rawData:{family_id:456},variants:[],links:[],price:100,availableQuantity:0,soldQuantity:0};
  expect(groupListings([row],{status:'closed'})[0]).toMatchObject({finalized:true,status:'closed',interactionBlocked:true});
  expect(groupListings([row],{status:'under_review'})).toHaveLength(0);
 });
 it('permits active items without a confirmed block',async()=>{
  const db=prisma();db.integrationSnapshot.findFirst.mockResolvedValue(null as never);
  await expect(assertListingWritable(db,'account',{status:'active',user_product_id:'UP1'})).resolves.toBeUndefined();
 });
 it('remembers a definitive provider rejection and blocks the next attempt locally',async()=>{
  const db:any=prisma();db.integrationSnapshot.findFirst.mockResolvedValue(null);db.integrationSnapshot.upsert=jest.fn().mockResolvedValue({});
  const rejection={response:{status:400,data:{cause:[{code:'seller.optin.fake'}]}}};
  const http:any={post:jest.fn().mockReturnValue(throwError(()=>rejection))},client=new MercadoLivreClient(http,db);
  jest.spyOn(client,'getUserProduct').mockResolvedValue({id:'UP1',user_id:123,family_id:456});
  await expect(client.createUserProductOffer('token','UP1',{})).rejects.toBe(rejection);
  expect(db.integrationSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({marketplaceAccountId:'account',key:'UP1',payload:expect.objectContaining({code:'seller.optin.fake',familyId:'456'})})}));
  db.integrationSnapshot.findFirst.mockResolvedValue({payload:{code:'seller.optin.fake'}});
  await expect(client.createUserProductOffer('token','UP1',{})).rejects.toThrow(FINALIZED_MESSAGE);
  expect(http.post).toHaveBeenCalledTimes(1);
 });
});
