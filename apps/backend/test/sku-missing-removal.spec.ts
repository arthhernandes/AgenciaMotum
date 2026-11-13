import { SkuMissingRemovalService } from '../src/chat/sku-missing-removal.service';
describe('Explicit deletion of offers whose size is absent in Bling',()=>{
 it('does not offer deletion for accented khaki and a Brazilian size already present in Bling',async()=>{
  const f=setup();f.item.attributes=[{id:'COLOR',value_name:'Cáqui'},{id:'SIZE',value_name:'42 BR'}];
  Object.assign(f.input,{noCorrespondence:true});f.bling.publicationSource.mockResolvedValue({rows:[{size:'42',color:'Caqui'}]});
  await expect(f.prepare()).rejects.toThrow('existem na Bling');
  expect(f.client.updateItem).not.toHaveBeenCalled();expect(f.client.deleteVariation).not.toHaveBeenCalled();
 });
 function setup(legacy=false){
  const item:any={id:'MLB1',seller_id:123,status:'active',sub_status:[],price:100,available_quantity:3,attributes:[{id:'COLOR',value_name:'Preto'},{id:'SIZE',value_name:'GG'}],variations:legacy?[{id:10,attributes:[{id:'SIZE',value_name:'GG'}]},{id:20,attributes:[{id:'SIZE',value_name:'G'}]}]:[]};
  const source={item,account:{id:'ml',sellerId:'123'},token:'secret'};
  const prisma:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'bling',businessKey:'outlet4u'})},auditLog:{create:jest.fn().mockResolvedValue({id:'audit'}),update:jest.fn(),findFirst:jest.fn()}};
  const market:any={authorizeFiscal:jest.fn(),fiscalSources:jest.fn().mockImplementation(async()=>[structuredClone(source)]),saveLocal:jest.fn()};
  const client:any={getItem:jest.fn().mockImplementation(async()=>structuredClone(item)),updateItem:jest.fn().mockImplementation(async(_t,_id,body)=>{if(body.status)item.status=body.status;if(body.deleted)item.sub_status=['deleted'];return structuredClone(item);}),deleteVariation:jest.fn().mockImplementation(async(_t,_id,id)=>{item.variations=item.variations.filter((v:any)=>String(v.id)!==id);})};
  const bling:any={publicationSource:jest.fn().mockResolvedValue({rows:[{size:'P'},{size:'M'},{size:'G'}]})};const saved=new Map<string,any>(),claimed=new Set<string>();
  const pending:any={save:jest.fn(async(value:any)=>{saved.set(value.id,value);}),load:jest.fn(async(id:string)=>claimed.has(id)?undefined:saved.get(id)),claim:jest.fn(async(id:string)=>{if(claimed.has(id))throw Error('claimed');claimed.add(id);})};
  const service=new SkuMissingRemovalService(prisma,client,bling,market,pending),input={reference:'MLB1',parentSku:'58087',mlb:'MLB1',variationId:legacy?'10':''};
  jest.spyOn(service as any,'readbackDelay').mockResolvedValue(undefined);
  return {service,item,source,prisma,market,client,bling,pending,input,prepare:()=>service.prepare('bling','u',input)};
 }
 it('performs no write during preview, then closes and deletes only the explicitly confirmed MLB',async()=>{const f=setup(),review=await f.prepare();expect(review.size).toBe('GG');expect(f.client.updateItem).not.toHaveBeenCalled();const result=await f.service.confirm('bling','u',review.id);expect(result.success).toBe(true);expect(f.client.updateItem.mock.calls.map((c:any[])=>c[2])).toEqual([{status:'closed'},{deleted:true}]);expect(f.bling.publicationSource).toHaveBeenCalledTimes(2);expect(f.market.saveLocal).toHaveBeenCalledTimes(1);await expect(f.service.confirm('bling','u',review.id)).rejects.toThrow('já foi utilizada');expect(f.client.updateItem).toHaveBeenCalledTimes(2);});
 it('blocks exclusion when the size exists or appears in Bling before confirmation',async()=>{const f=setup(),review=await f.prepare();f.bling.publicationSource.mockResolvedValue({rows:[{size:'GG'}]});await expect(f.service.confirm('bling','u',review.id)).rejects.toThrow('existe na Bling');expect(f.client.updateItem).not.toHaveBeenCalled();await expect(f.prepare()).rejects.toThrow('existe na Bling');});
 it('blocks unknown sizes, unavailable catalogs, wrong owners and unrelated offers',async()=>{for(const scenario of ['size','catalog','owner','scope']){const f=setup();if(scenario==='size')f.item.attributes=[];if(scenario==='catalog')f.bling.publicationSource.mockRejectedValue(new Error('offline'));if(scenario==='owner')f.item.seller_id=999;if(scenario==='scope')f.input.mlb='MLB99';await expect(f.prepare()).rejects.toThrow();expect(f.client.updateItem).not.toHaveBeenCalled();}});
 it('rejects changed offers before deletion',async()=>{const f=setup(),review=await f.prepare();f.item.available_quantity=2;await expect(f.service.confirm('bling','u',review.id)).rejects.toThrow('mudou');expect(f.client.updateItem).not.toHaveBeenCalled();});
 it('deletes only the selected legacy variation and verifies the remaining IDs',async()=>{const f=setup(true),review=await f.prepare();const result=await f.service.confirm('bling','u',review.id);expect(result.success).toBe(true);expect(f.client.deleteVariation).toHaveBeenCalledWith('secret','MLB1','10');expect(f.item.variations.map((v:any)=>v.id)).toEqual([20]);expect(f.client.updateItem).not.toHaveBeenCalled();});
 it('does not automatically retry an uncertain deletion',async()=>{const f=setup(),review=await f.prepare();f.client.updateItem.mockRejectedValueOnce(new Error('timeout'));expect((await f.service.confirm('bling','u',review.id)).success).toBe(false);await expect(f.service.confirm('bling','u',review.id)).rejects.toThrow();expect(f.client.updateItem).toHaveBeenCalledTimes(1);expect(f.market.saveLocal).not.toHaveBeenCalled();});
 it('allows a user-declared missing color even when the size exists, only after confirmation',async()=>{
  const f=setup(true);f.item.variations[0].attributes.push({id:'COLOR',value_name:'Azul Pequim'});
  Object.assign(f.input,{noCorrespondence:true});
  f.bling.publicationSource.mockResolvedValue({rows:[{size:'GG',color:'Azul Royal'},{size:'G',color:'Azul Pequim'}]});
  const review=await f.prepare();expect(f.client.deleteVariation).not.toHaveBeenCalled();
  expect((await f.service.confirm('bling','u',review.id)).success).toBe(true);
  expect(f.client.deleteVariation).toHaveBeenCalledWith('secret','MLB1','10');
 });
 it('blocks user-declared absence when the matching color and size appear before confirmation',async()=>{
  const f=setup();Object.assign(f.input,{noCorrespondence:true});
  f.bling.publicationSource.mockResolvedValue({rows:[{size:'GG',color:'Azul'}]});
  const review=await f.prepare();
  f.bling.publicationSource.mockResolvedValue({rows:[{size:'GG',color:'Preta'}]});
  await expect(f.service.confirm('bling','u',review.id)).rejects.toThrow('cor e tamanho existem');
  expect(f.client.updateItem).not.toHaveBeenCalled();
 });
 it('requires explicit absence declaration and complete colors for a size present in Bling',async()=>{
  const f=setup();f.bling.publicationSource.mockResolvedValue({rows:[{size:'GG',color:'Azul'}]});
  await expect(f.prepare()).rejects.toThrow('tamanho existe');
  Object.assign(f.input,{noCorrespondence:true});f.bling.publicationSource.mockResolvedValue({rows:[{size:'GG'}]});
  await expect(f.prepare()).rejects.toThrow('cores');expect(f.client.updateItem).not.toHaveBeenCalled();
 });
 it('continues multiple reviewed removals on the same MLB using verified readbacks',async()=>{
  const f=setup(true);
  f.item.variations=[{id:10,attributes:[{id:'SIZE',value_name:'GG'}]},{id:20,attributes:[{id:'SIZE',value_name:'GG'}]},{id:30,attributes:[{id:'SIZE',value_name:'GG'}]},{id:40,attributes:[{id:'SIZE',value_name:'G'}]}];
  const reviews=[];
  for(const variationId of ['10','20','30']) reviews.push(await f.service.prepare('bling','u',{...f.input,variationId}));
  let verified:any;
  f.prisma.auditLog.update.mockImplementation(async({data}:any)=>{verified={after:data.after};});
  f.prisma.auditLog.findFirst.mockImplementation(async()=>verified);
  for(let i=0;i<reviews.length;i++){
   const result=await f.service.confirm('bling','u',reviews[i].id,i?reviews[i-1].id:undefined);
   expect(result.success).toBe(true);
  }
  expect(f.client.deleteVariation.mock.calls.map((call:any[])=>call[2])).toEqual(['10','20','30']);
  expect(f.item.variations.map((v:any)=>v.id)).toEqual([40]);
 });
 it('still blocks external changes between two removals in a batch',async()=>{
  const f=setup(true);f.item.variations.push({id:30,attributes:[{id:'SIZE',value_name:'GG'}]});
  const first=await f.prepare(),second=await f.service.prepare('bling','u',{...f.input,variationId:'30'});
  let verified:any;f.prisma.auditLog.update.mockImplementation(async({data}:any)=>{verified={after:data.after};});f.prisma.auditLog.findFirst.mockImplementation(async()=>verified);
  await f.service.confirm('bling','u',first.id);f.item.price=200;
  await expect(f.service.confirm('bling','u',second.id,first.id)).rejects.toThrow('mudou');
  expect(f.client.deleteVariation).toHaveBeenCalledTimes(1);
 });
 it('rejects continuation from another account, snapshot or an unverified removal',async()=>{
  for(const scenario of ['account','snapshot','status']){
   const f=setup(true),review=await f.prepare();const saved=f.pending.save.mock.calls[0][0];
   f.prisma.auditLog.findFirst.mockResolvedValue({after:{status:scenario==='status'?'UNVERIFIED':'VERIFIED',accountId:scenario==='account'?'other':'bling',rootFingerprint:scenario==='snapshot'?'other':saved.fingerprint,fingerprint:saved.fingerprint}});
   await expect(f.service.confirm('bling','u',review.id,'previous')).rejects.toThrow('revisão');
   expect(f.client.deleteVariation).not.toHaveBeenCalled();
  }
 });
 it('verifies a deletion that applied despite a write timeout, without resending it',async()=>{
  const f=setup(true),review=await f.prepare();
  f.client.deleteVariation.mockImplementationOnce(async()=>{f.item.variations=f.item.variations.filter((v:any)=>v.id!==10);throw Object.assign(new Error('timeout'),{code:'ECONNABORTED'});});
  const result=await f.service.confirm('bling','u',review.id);
  expect(result.success).toBe(true);expect(f.client.deleteVariation).toHaveBeenCalledTimes(1);
  expect(f.market.saveLocal).toHaveBeenCalledWith(f.source.account,f.item);
  expect(f.prisma.auditLog.update.mock.calls[0][0].data.after.status).toBe('VERIFIED');
 });
 it('polls only reads when the removed variation briefly remains in the provider response',async()=>{
  const f=setup(true),review=await f.prepare(),old=structuredClone(f.item);
  f.client.getItem.mockResolvedValueOnce(old);
  expect((await f.service.confirm('bling','u',review.id)).success).toBe(true);
  expect(f.client.deleteVariation).toHaveBeenCalledTimes(1);expect(f.client.getItem).toHaveBeenCalledTimes(2);
 });
 it('keeps an uncertain deletion unverified when readback is unavailable',async()=>{
  const f=setup(true),review=await f.prepare();f.client.getItem.mockRejectedValue(new Error('offline'));
  expect((await f.service.confirm('bling','u',review.id)).success).toBe(false);
  expect(f.client.deleteVariation).toHaveBeenCalledTimes(1);expect(f.client.getItem).toHaveBeenCalledTimes(3);expect(f.market.saveLocal).not.toHaveBeenCalled();
 });
});
