import { of } from 'rxjs';
import { ChatSizeChartCreationService, chartBody, validateChartImage } from '../src/chat/chat-size-chart-creation.service';
import { sizeChartName } from '../src/mercadolivre/size-chart-name';

describe('Reviewed size charts extracted from images or text',()=>{
  function setup(){
    const records:any[]=[];
    const prisma={user:{findUnique:jest.fn().mockResolvedValue({active:true,role:'ADMIN'})},marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'account',businessKey:'mottum'})},productVariant:{findUnique:jest.fn().mockResolvedValue({product:{title:'Polo Levis',variants:[{size:'P'}]}})},auditLog:{
      create:jest.fn(async({data})=>{const row={id:'record-'+records.length,...structuredClone(data)};records.push(row);return structuredClone(row);}),
      findFirst:jest.fn(async({where})=>{const row=records.find(row=>row.id===where.id&&row.userId===where.userId&&row.action===where.action&&row.before.accountId===where.before.equals);return row?structuredClone(row):null;}),
      updateMany:jest.fn(async({where,data})=>{const row=records.find(row=>row.id===where.id&&JSON.stringify(row.after)===JSON.stringify(where.after.equals));if(!row)return {count:0};Object.assign(row,structuredClone(data));return {count:1};}),
      update:jest.fn(async({where,data})=>{const row=records.find(row=>row.id===where.id);Object.assign(row,structuredClone(data));return structuredClone(row);})}};
    const source={token:'private',account:{id:'ml',sellerId:'123',name:'Motum'},item:{id:'MLB1',domain_id:'MLB-SHIRTS',title:'Polo',attributes:[{id:'SELLER_SKU',value_name:'sku'},{id:'BRAND',value_name:'Levis'}]}};
    const market={chartSource:jest.fn().mockResolvedValue(source),authorizeFiscal:jest.fn()};
    const specs={attributes:[{id:'SIZE',value_type:'string'},{id:'FILTRABLE_SIZE',value_type:'list',values:[{id:'p',name:'P'}]},{id:'GARMENT_CHEST_WIDTH_FROM',name:'Largura do peito',value_type:'number_unit',tags:['CLOTHING_MEASURE','required'],units:[{id:'cm'}]}]};
    const client={getSizeChartSpecs:jest.fn().mockResolvedValue(specs),createSizeChart:jest.fn().mockResolvedValue({id:'44'}),getSizeChart:jest.fn().mockResolvedValue({id:'44',seller_id:123,site_id:'MLB',domain_id:'SHIRTS',names:{MLB:sizeChartName('Polo Levis')},rows:[{attributes:[{id:'SIZE',values:[{name:'P'}]},{id:'FILTRABLE_SIZE',values:[{id:'p'}]},{id:'GARMENT_CHEST_WIDTH_FROM',values:[{struct:{number:48,unit:'cm'}}]}]}]})};
    const http={post:jest.fn().mockReturnValue(of({data:{choices:[{message:{content:JSON.stringify({rows:[{size:'P',measurements:{GARMENT_CHEST_WIDTH_FROM:48}}],warnings:[]})}}]}}))};
    const config={get:(key:string,fallback:any)=>({CHAT_PROVIDER:'qwen',CHAT_BASE_URL:'http://localhost:11434/v1',CHAT_MODEL:'qwen-vision'} as any)[key]??fallback};
    const service=new ChatSizeChartCreationService(prisma as never,market as never,client as never,http as never,config as never);
    return {service,prisma,market,client,http,records,config,source};
  }
  const input={anuncio:'MLB1',text:'Roupa em cm: P largura do peito 48.',measureType:'CLOTHING_MEASURE' as const};
  it('opens a new-product guide from category metadata without requiring an existing Mercado Livre ad',async()=>{
    const f=setup();const source={...f.source,item:{...f.source.item,id:'creation:abc'}};
    const draft=await f.service.prepareForCreation('account','user',source,'Polo Levis',['P'],'CLOTHING_MEASURE','scope');
    expect(draft.rows[0]).toMatchObject({size:'P',equivalentId:'p',measurements:{GARMENT_CHEST_WIDTH_FROM:null}});expect(f.market.chartSource).not.toHaveBeenCalled();expect(f.client.createSizeChart).not.toHaveBeenCalled();expect(f.records[0].before).toMatchObject({purpose:'LISTING_CREATION',creationContext:'scope'});
  });
  it('registers and verifies the new-product guide once and blocks cross-context reuse',async()=>{
    const f=setup();const source={...f.source,item:{...f.source.item,id:'creation:abc'}};
    const draft=await f.service.prepareForCreation('account','user',source,'Polo Levis',['P'],'CLOTHING_MEASURE','scope');
    draft.rows[0].measurements.GARMENT_CHEST_WIDTH_FROM=48;
    await expect(f.service.create(draft.id,'account','user',draft.rows)).rejects.toThrow('mudaram');
    await expect(f.service.createForCreation(draft.id,'account','user',draft.rows,source,'other')).rejects.toThrow('mudaram');expect(f.client.createSizeChart).not.toHaveBeenCalled();
    expect((await f.service.createForCreation(draft.id,'account','user',draft.rows,source,'scope')).id).toBe('44');
    expect((await f.service.createForCreation(draft.id,'account','user',draft.rows,source,'scope')).id).toBe('44');
    expect(f.client.createSizeChart).toHaveBeenCalledTimes(1);expect(f.market.chartSource).not.toHaveBeenCalled();
  });
  it('requires real measurements and preserves uncertainty instead of retrying an unconfirmed new-product guide',async()=>{
    const f=setup();const draft=await f.service.prepareForCreation('account','user',f.source,'Polo Levis',['P'],'CLOTHING_MEASURE','scope');
    await expect(f.service.createForCreation(draft.id,'account','user',draft.rows,f.source,'scope')).rejects.toThrow('Preencha');expect(f.client.createSizeChart).not.toHaveBeenCalled();
    draft.rows[0].measurements.GARMENT_CHEST_WIDTH_FROM=48;f.client.createSizeChart.mockRejectedValue(new Error('timeout'));
    await expect(f.service.createForCreation(draft.id,'account','user',draft.rows,f.source,'scope')).rejects.toThrow('pode ter sido aplicado');
    await expect(f.service.createForCreation(draft.id,'account','user',draft.rows,f.source,'scope')).rejects.toThrow('já foi enviado');expect(f.client.createSizeChart).toHaveBeenCalledTimes(1);
  });
  it('opens a manual editor without calling an AI provider or creating a chart',async()=>{
    const f=setup();const draft=await f.service.prepareManual('account','user',{anuncio:'MLB1',measureType:'CLOTHING_MEASURE',requiredSizes:['P']});
    expect(draft.rows[0]).toMatchObject({size:'P',measurements:{GARMENT_CHEST_WIDTH_FROM:null}});
    expect(draft.fields[0].name).toBe('Largura do peito');
    expect(f.http.post).not.toHaveBeenCalled();expect(f.client.createSizeChart).not.toHaveBeenCalled();
  });
  it('extracts a reviewable draft without registering a chart or publishing an item',async()=>{
    const {service,client}=setup();const draft=await service.prepare('account','user',input);expect(draft.rows).toEqual([{size:'P',equivalentId:'p',measurements:{GARMENT_CHEST_WIDTH_FROM:48}}]);expect(draft.name).toBe(sizeChartName('Polo Levis'));expect(draft.requiredSizes).toEqual(['P']);expect(client.createSizeChart).not.toHaveBeenCalled();
  });
  it('sends the photo to the configured local model and never persists its base64 in audit records',async()=>{
    const {service,http,records}=setup();const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,217]).toString('base64');await service.prepare('account','user',{...input,image});expect(http.post.mock.calls[0][1].messages[1].content).toContainEqual({type:'image_url',image_url:{url:image}});expect(JSON.stringify(records)).not.toContain(image);
  });
  it('keeps missing measures blank and blocks confirmation instead of filling guessed values',async()=>{
    const {service,http,client}=setup();http.post.mockReturnValue(of({data:{choices:[{message:{content:'{"rows":[{"size":"P","measurements":{}}],"warnings":["Medida ilegível"]}'}}]}}));const draft=await service.prepare('account','user',input);expect(draft.rows[0].measurements.GARMENT_CHEST_WIDTH_FROM).toBeNull();await expect(service.create(draft.id,'account','user',draft.rows)).rejects.toThrow('Preencha');expect(client.createSizeChart).not.toHaveBeenCalled();
  });
  it('registers exactly once after review and retains idempotency after a service restart',async()=>{
    const {service,prisma,market,client,http,config,records}=setup();const draft=await service.prepare('account','user',input);const result=await service.create(draft.id,'account','user',draft.rows);expect(result.id).toBe('44');expect(client.createSizeChart).toHaveBeenCalledTimes(1);const restarted=new ChatSizeChartCreationService(prisma as never,market as never,client as never,http as never,config as never);expect((await restarted.create(draft.id,'account','user',draft.rows)).id).toBe('44');expect(client.createSizeChart).toHaveBeenCalledTimes(1);expect(records.find(row=>row.action==='CHAT_ACTION').after.status).toBe('SUCCESS');
  });
  it('does not repeat an ambiguous provider timeout',async()=>{
    const {service,client}=setup();const draft=await service.prepare('account','user',input);client.createSizeChart.mockRejectedValue(new Error('timeout'));await expect(service.create(draft.id,'account','user',draft.rows)).rejects.toThrow('pode ter sido aplicado');await expect(service.create(draft.id,'account','user',draft.rows)).rejects.toThrow('já foi enviado');expect(client.createSizeChart).toHaveBeenCalledTimes(1);
  });
  it('rejects another account or user before accessing the provider',async()=>{
    const {service,client}=setup();const draft=await service.prepare('account','user',input);await expect(service.create(draft.id,'other-account','user',draft.rows)).rejects.toThrow('não encontrada');await expect(service.create(draft.id,'account','other-user',draft.rows)).rejects.toThrow('não encontrada');expect(client.createSizeChart).not.toHaveBeenCalled();
  });
  it('validates full size coverage and does not reinterpret width as circumference',async()=>{
    const {service}=setup();const draft=await service.prepare('account','user',input);const body=chartBody(draft,draft.rows);expect(body.rows[0].attributes.find(attribute=>attribute.id==='GARMENT_CHEST_WIDTH_FROM').values[0].struct.number).toBe(48);expect(()=>chartBody({...draft,requiredSizes:['P','M']},draft.rows)).toThrow('M');
  });
  it('rejects unsupported or oversized images before model extraction',()=>{
    expect(()=>validateChartImage('data:image/svg+xml;base64,PHN2Zz4=')).toThrow('JPG');expect(()=>validateChartImage('data:image/png;base64,YWJj')).toThrow('não corresponde');expect(()=>validateChartImage('data:image/jpeg;base64,'+Buffer.alloc(5*1024*1024+1).toString('base64'))).toThrow('5 MB');
  });
});
