import { ListingVisitsService } from '../src/listings/listing-visits.service';
import { MercadoLivreClient } from '../src/mercadolivre/mercadolivre.client';
import { of } from 'rxjs';

describe('Listing visits',()=>{
 it('reads arbitrary periods from the permanent daily archive without requesting a token',async()=>{
  const {service,client,auth,prisma}=setup();prisma.integrationSnapshot.findMany.mockImplementation(async({where}:any)=>where.category==='VISITS_DAILY'?[{marketplaceAccountId:'meli',payload:{itemId:'MLB1',sellerId:'7',unit:'visits',coverage:[{from:'2026-10-01',to:'2026-10-10'}],values:{'2026-10-02':7,'2026-10-03':4},checkedAt:new Date().toISOString()}}]:[]);
  expect((await service.find('bling',['MLB1'],'2026-10-02','2026-10-03')).items[0].visits).toBe(11);expect(client.getItemVisits).not.toHaveBeenCalled();expect(auth.getValidAccessToken).not.toHaveBeenCalled();
 });
 it('restores saved visits in a new service instance without another provider read',async()=>{
  const {service,client,auth,prisma}=setup();await service.find('bling',['MLB1'],'2026-10-01','2026-10-02');
  const record=prisma.integrationSnapshot.upsert.mock.calls[0][0].create;prisma.integrationSnapshot.findMany.mockResolvedValue([record]);
  const restored=await new ListingVisitsService(prisma,client,auth).find('bling',['MLB1'],'2026-10-01','2026-10-02');expect(restored.items[0].visits).toBe(10);expect(client.getItemVisits).toHaveBeenCalledTimes(1);
 });
 it('separates cached date ranges and includes the final selected day',async()=>{
  const {service,client}=setup();
  await service.find('bling',['MLB1'],'2026-10-01','2026-10-02');
  await service.find('bling',['MLB1'],'2026-10-01','2026-10-02');
  expect(client.getItemVisits).toHaveBeenCalledTimes(1);
  expect(client.getItemVisits).toHaveBeenCalledWith('private-token',['MLB1'],{dateFrom:'2026-10-01',dateTo:'2026-10-02'});
  await service.find('bling',['MLB1'],'2026-10-03','2026-10-03');
  expect(client.getItemVisits).toHaveBeenCalledTimes(2);
 });
 it('rejects incomplete, impossible, reversed, future and oversized periods before provider calls',async()=>{
  const {service,client}=setup();
  for(const [from,to] of [['2026-10-01',undefined],['2026-02-30','2026-03-02'],['2026-10-02','2026-10-01'],['2999-01-01','2999-01-01'],['2025-01-01','2025-12-31']])await expect(service.find('bling',['MLB1'],from,to)).rejects.toThrow();
  expect(client.getItemVisits).not.toHaveBeenCalled();
 });
 it('queries explicit dates through the visits interval endpoint',async()=>{
  const http:any={get:jest.fn().mockReturnValue(of({data:[{item_id:'MLB1',total_visits:12}]}))};
  const client=new MercadoLivreClient(http);
  expect(await client.getItemVisits('token',['MLB1'],{dateFrom:'2026-10-01',dateTo:'2026-10-02'})).toEqual([{item_id:'MLB1',total_visits:12}]);
  expect(http.get.mock.calls[0][0]).toBe('https://api.mercadolibre.com/items/visits');
  expect(http.get.mock.calls[0][1].params).toEqual({ids:'MLB1',date_from:'2026-10-01',date_to:'2026-10-02'});
 });
 it('preserves the selected period when refreshing an expired token',async()=>{
  const {service,client}=setup();client.getItemVisits.mockRejectedValueOnce({response:{status:401}}).mockResolvedValueOnce([{item_id:'MLB1',total_visits:5}]);
  await service.find('bling',['MLB1'],'2026-10-01','2026-10-02');
  expect(client.getItemVisits.mock.calls[1][2]).toEqual(client.getItemVisits.mock.calls[0][2]);
 });
 function setup(){
  const prisma:any={integrationSnapshot:{findMany:jest.fn().mockResolvedValue([]),upsert:jest.fn().mockResolvedValue({})},marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'bling',businessKey:'outlet4u',marketplace:'BLING'})},marketplaceListing:{findMany:jest.fn().mockImplementation(async({where}:any)=>[{itemId:'MLB1',marketplaceAccountId:'meli'},{itemId:'MLB2',marketplaceAccountId:'meli'}].filter(item=>where.itemId.in.includes(item.itemId)))}};
  const auth:any={getValidAccessToken:jest.fn().mockResolvedValue('private-token')};
  const client:any={getItemVisits:jest.fn().mockImplementation(async(_token:string,ids:string[])=>ids.map(item_id=>({item_id,total_visits:item_id==='MLB1'?10:0,date_from:'2026-09-21',date_to:'2026-10-21'})))};
  return {prisma,auth,client,service:new ListingVisitsService(prisma,client,auth)};
 }
 it('returns each requested item once, preserves zero visits and caches successful reads',async()=>{
  const {service,client}=setup();const value=await service.find('bling',['MLB1','MLB2','MLB1']);expect(value.items.map(i=>[i.itemId,i.visits])).toEqual([['MLB1',10],['MLB2',0]]);expect(client.getItemVisits.mock.calls.every((call:any)=>call[1].length===1)).toBe(true);await service.find('bling',['MLB1','MLB2']);expect(client.getItemVisits).toHaveBeenCalledTimes(2);
 });
 it('rejects foreign IDs before querying the marketplace',async()=>{const {service,client,prisma}=setup();await expect(service.find('bling',['MLB999'])).rejects.toThrow('não pertence');expect(client.getItemVisits).not.toHaveBeenCalled();expect(prisma.marketplaceListing.findMany.mock.calls[0][0].where.marketplaceAccount).toEqual({businessKey:'outlet4u',marketplace:'MERCADO_LIVRE'});});
 it('does not cache failed reads or invent zero visits',async()=>{const {service,client}=setup();client.getItemVisits.mockRejectedValueOnce({response:{status:403}});const value=await service.find('bling',['MLB1']);expect(value.items[0].visits).toBeNull();expect((await service.find('bling',['MLB1'])).items[0].visits).toBe(10);expect(client.getItemVisits).toHaveBeenCalledTimes(2);});
 it('retries temporary errors and rate limits automatically',async()=>{
  const {service,client}=setup();jest.spyOn(service as any,'pause').mockResolvedValue(undefined);
  client.getItemVisits.mockRejectedValueOnce({response:{status:429,headers:{'retry-after':'1'}}}).mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce([{item_id:'MLB1',total_visits:42}]);
  expect((await service.find('bling',['MLB1'])).items[0].visits).toBe(42);expect(client.getItemVisits).toHaveBeenCalledTimes(3);
 });
 it('rejects mismatched, missing and malformed metric values',async()=>{const {service,client}=setup();client.getItemVisits.mockResolvedValue([{item_id:'MLB999',total_visits:90},{item_id:'MLB1',total_visits:'10'},{item_id:'MLB2',total_visits:-1}]);expect((await service.find('bling',['MLB1','MLB2'])).items.every(i=>i.visits===null)).toBe(true);});
 it('refreshes an expired token once before retrying a read',async()=>{const {service,client,auth,prisma}=setup();prisma.marketplaceListing.findMany.mockResolvedValue([{itemId:'MLB1',marketplaceAccountId:'meli'}]);client.getItemVisits.mockRejectedValueOnce({response:{status:401}}).mockResolvedValueOnce([{item_id:'MLB1',total_visits:5}]);expect((await service.find('bling',['MLB1'])).items[0].visits).toBe(5);expect(auth.getValidAccessToken).toHaveBeenCalledWith('meli',true);});
 it('does not share cached statistics between marketplace accounts',async()=>{const {service,client,prisma}=setup();prisma.marketplaceListing.findMany.mockResolvedValue([{itemId:'MLB1',marketplaceAccountId:'meli-a'}]);await service.find('bling',['MLB1']);prisma.marketplaceListing.findMany.mockResolvedValue([{itemId:'MLB1',marketplaceAccountId:'meli-b'}]);await service.find('bling',['MLB1']);expect(client.getItemVisits).toHaveBeenCalledTimes(2);});
 it('calls the current single-item endpoint with a 30-day window',async()=>{const http:any={get:jest.fn().mockReturnValue(of({data:{item_id:'MLB1',total_visits:12}}))};const client=new MercadoLivreClient(http);expect(await client.getItemVisits('token',['MLB1'])).toEqual([{item_id:'MLB1',total_visits:12}]);expect(http.get.mock.calls[0][0]).toBe('https://api.mercadolibre.com/items/MLB1/visits/time_window');expect(http.get.mock.calls[0][1].params).toEqual({last:30,unit:'day'});await expect(client.getItemVisits('token',['MLB1','MLB2'])).rejects.toThrow('um anúncio');});
});
