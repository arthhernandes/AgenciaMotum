import {ChatFamilyPublicationService} from '../src/chat/chat-family-publication.service';
import {replacementFingerprint} from '../src/chat/chat-family-publication.service';
import {catalogPresence} from '../src/chat/chat-catalog';

describe('explicit replacement of reviewed offers',()=>{
 it.each(['UN','Único','Unico'])('matches one-size cap %s without treating it as a missing product',size=>{
  const service=new ChatFamilyPublicationService({} as any,{} as any,{} as any,{} as any);
  const up={attributes:[{id:'COLOR',values:[{name:'Preto'}]},{id:'SIZE',values:[{name:size}]}]};
  expect((service as any).sameVariant(up,{color:'Preto',size:'Unico'})).toBe(true);
  expect((service as any).sameVariant(up,{color:'Preto',size:'M'})).toBe(false);
 });
 it('does not describe unprocessed rows as still queued after interruption',()=>{
  const service=new ChatFamilyPublicationService({} as any,{} as any,{} as any,{} as any);
  const job={status:'WAITING_DATA',rows:[{sku:'5586.40',status:'WAITING_DATA',message:'Closure not confirmed'},{sku:'5586.42',status:'QUEUED',message:'Aguardando consulta de estoque e publicação.'}]};
  const message=(service as any).message(job);
  expect(message).toContain('5586.42: Não enviada');expect(message).not.toContain('Aguardando consulta');
  expect(job.rows[1].status).toBe('QUEUED');
 });
 function setup(){
  let old:any={id:'MLB10',seller_id:123,user_product_id:'UP10',status:'under_review',sub_status:['held']};
  const requested={sku:'5586.37',replacementOffers:[{id:old.id,upId:'UP10',fingerprint:replacementFingerprint(old)}]};
  const state:any={sku:requested.sku,status:'QUEUED'};
  const job:any={plan:{accountId:'account',sellerId:'123'},rows:[state]};
  const prisma:any={auditLog:{findFirst:jest.fn().mockResolvedValue(null),update:jest.fn()},marketplaceListing:{updateMany:jest.fn()}};
  const client:any={getItemModerations:jest.fn().mockResolvedValue({infractions:[]}),searchUserProductOffers:jest.fn().mockResolvedValue(['MLB10']),getItem:jest.fn(async()=>structuredClone(old)),updateItem:jest.fn(async()=>{old.status='closed';})};
  const service=new ChatFamilyPublicationService(prisma,{} as any,client,{} as any);
  return {prisma,client,service,requested,state,job,old,run:()=>(service as any).closeReplacementOffers('job',job,'token',requested,state)};
 }
 it('offers replacement for under-review sizes while keeping paused and active offers protected',()=>{
  for(const status of ['under_review','paused','active']){
   const result=catalogPresence({sku:'5586.37',color:'Branco',size:'P'},{anuncios:[{status,variacoes:[{sku:'5586.37'}]}]});
   expect(result.substituivelEmAnalise===true).toBe(status==='under_review');
  }
 });
 it('closes only the explicitly reviewed offer and records verified closure before continuing',async()=>{
  const f=setup();expect(await f.run()).toBe(true);
  expect(f.client.updateItem).toHaveBeenCalledWith('token','MLB10',{status:'closed'});
  expect(f.state.replacementClosed).toEqual(['MLB10']);expect(f.prisma.marketplaceListing.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{marketplaceAccountId:'account',itemId:'MLB10'}}));
 });
 it('blocks a previously reviewed offer that has become active',async()=>{
  const f=setup();f.old.status='active';await expect(f.run()).rejects.toThrow('mudou');expect(f.client.updateItem).not.toHaveBeenCalled();
 });
 it('blocks a changed seller or user product without writing',async()=>{
  for(const field of ['seller_id','user_product_id']){const f=setup();f.old[field]='other';await expect(f.run()).rejects.toThrow();expect(f.client.updateItem).not.toHaveBeenCalled();}
 });
 it('recovers closure applied despite a timeout and does not send it twice',async()=>{
  const f=setup();f.client.updateItem.mockImplementation(async()=>{f.old.status='closed';throw Error('timeout');});
  expect(await f.run()).toBe(true);expect(await f.run()).toBe(true);expect(f.client.updateItem).toHaveBeenCalledTimes(1);
 });
 it('does not publish or resend closure while its readback remains uncertain',async()=>{
  const f=setup();f.state.replacementSent=['MLB10'];expect(await f.run()).toBe(false);expect(f.client.updateItem).not.toHaveBeenCalled();expect(f.state.replacementClosed).toBeUndefined();expect(f.job.status).toBe('WAITING_DATA');
 });
 it('stops without closure when the provider requires a correction and displays its reason',async()=>{
  const f=setup();f.old.sub_status=['waiting_for_patch'];f.client.getItemModerations.mockResolvedValue({infractions:[{related_item_id:'MLB10',reason:'Os dados do produto não coincidiam entre si.',remedy:''}]});
  expect(await f.run()).toBe(false);expect(f.client.updateItem).not.toHaveBeenCalled();expect(f.state.message).toContain('Os dados do produto');expect(f.job.status).toBe('WAITING_DATA');
 });
 it('stops previously sent closures in a moderated inactive state rather than polling forever',async()=>{
  const f=setup();f.state.replacementSent=['MLB10'];f.old.status='inactive';f.old.sub_status=['waiting_for_patch'];
  expect(await f.run()).toBe(false);expect(f.client.updateItem).not.toHaveBeenCalled();expect(f.job.status).toBe('WAITING_DATA');
 });
 it('ignores unrelated volatile read fields but still guards material changes',()=>{
  const f=setup(),before=replacementFingerprint(f.old);
  expect(replacementFingerprint({...f.old,last_updated:'new',health:0.9,available_quantity:99})).toBe(before);
  expect(replacementFingerprint({...f.old,price:100})).not.toBe(before);
  expect(replacementFingerprint({...f.old,status:'active'})).not.toBe(before);
 });
 it('uses the same spelling and size equivalents as the catalog list',()=>{
  const f=setup();const product={attributes:[{id:'COLOR',values:[{name:'Verde-claro'}]},{id:'SIZE',values:[{name:'XGGG'}]}]};
  expect((f.service as any).sameVariant(product,{color:'Verde Claro',size:'XXXG'})).toBe(true);
  expect((f.service as any).sameVariant(product,{color:'Verde Escuro',size:'XXXG'})).toBe(false);
  expect((f.service as any).sameVariant(product,{color:'Verde Claro',size:'M'})).toBe(false);
 });
 it('does not close an offer forbidden for missing documentation and reports the actual reason',async()=>{
  const f=setup();f.old.sub_status=['forbidden'];f.client.getItemModerations.mockResolvedValue({infractions:[{related_item_id:'MLB10',reason:'Você não enviou a NF-e para comprovar a originalidade do produto.'}]});
  expect(await f.run()).toBe(false);expect(f.client.updateItem).not.toHaveBeenCalled();expect(f.state.message).toContain('NF-e');expect(f.job.status).toBe('WAITING_DATA');
 });
});
