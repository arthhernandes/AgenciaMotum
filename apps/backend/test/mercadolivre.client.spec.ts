import { of, throwError } from 'rxjs';
import { MercadoLivreClient } from '../src/mercadolivre/mercadolivre.client';

describe('MercadoLivreClient', () => {
  it('normalizes the current bulk response and preserves failed item identities',async()=>{const http={get:jest.fn().mockReturnValue(of({data:[{status:200,body:{id:'MLB1',seller_id:123}},{status:404,body:{error:'not_found'}}]}))};expect(await new MercadoLivreClient(http as any).getItems('token',['MLB1','MLB2'])).toEqual([{code:200,body:{id:'MLB1',seller_id:123}},{code:404,body:{id:'MLB2',error:'not_found'}}]);});
  it('recovers a deprecated bulk resource using individual reads without suppressing other forbidden errors',async()=>{const http={get:jest.fn().mockReturnValueOnce(throwError(()=>({response:{status:403,data:{error:'ResourceDeprecated'}}}))).mockReturnValueOnce(of({data:{id:'MLB1'}})).mockReturnValueOnce(throwError(()=>({response:{status:404}})))};const client=new MercadoLivreClient(http as any);expect(await client.getItems('token',['MLB1','MLB2'])).toEqual([{code:200,body:{id:'MLB1'}},{code:404,body:{id:'MLB2'}}]);http.get.mockReturnValue(throwError(()=>({response:{status:403,data:{error:'forbidden'}}})));await expect(client.getItems('token',['MLB1'])).rejects.toEqual(expect.objectContaining({response:expect.objectContaining({status:403})}));expect(http.get).toHaveBeenCalledTimes(4);});
  it('fails rather than reporting success for an incomplete bulk response',async()=>{const http={get:jest.fn().mockReturnValue(of({data:[]}))};await expect(new MercadoLivreClient(http as any).getItems('token',['MLB1'])).rejects.toThrow('incomplete');});
  it('waits and checks a SKU after a 429 before retrying the rejected correction',async()=>{
    const rejected={response:{status:429,headers:{'retry-after':'3'}}};
    const http={put:jest.fn().mockReturnValueOnce(throwError(()=>rejected)).mockReturnValueOnce(of({data:{id:'MLB1'}})),get:jest.fn().mockReturnValue(of({data:{id:'MLB1',attributes:[]}}))};
    const client=new MercadoLivreClient(http as any),pause=jest.spyOn(client as any,'skuPause').mockResolvedValue(undefined);
    await client.updateItem('token','MLB1',{attributes:[{id:'SELLER_SKU',value_name:'8113.12'}]});
    expect(pause).toHaveBeenCalledWith(3000);expect(http.get).toHaveBeenCalledTimes(1);expect(http.put).toHaveBeenCalledTimes(2);
  });
  it('does not repeat a SKU correction already confirmed after the rate-limit response',async()=>{
    const attributes=[{id:'SELLER_SKU',value_name:'8113.12'}];
    const http={put:jest.fn().mockReturnValue(throwError(()=>({response:{status:429}}))),get:jest.fn().mockReturnValue(of({data:{id:'MLB1',attributes}}))};
    const client=new MercadoLivreClient(http as any);jest.spyOn(client as any,'skuPause').mockResolvedValue(undefined);
    await client.updateItem('token','MLB1',{attributes});expect(http.put).toHaveBeenCalledTimes(1);
  });
  it('does not retry a SKU correction with an uncertain timeout',async()=>{
    const http={put:jest.fn().mockReturnValue(throwError(()=>Error('timeout'))),get:jest.fn()};
    await expect(new MercadoLivreClient(http as any).updateItem('token','MLB1',{attributes:[{id:'SELLER_SKU',value_name:'8113.12'}]})).rejects.toThrow('timeout');
    expect(http.put).toHaveBeenCalledTimes(1);expect(http.get).not.toHaveBeenCalled();
  });
  it('requests seller SKU attributes during batch synchronization', async () => {
    const http = {get:jest.fn().mockReturnValue(of({data:[{code:200,body:{id:'MLB1'}}]}))};
    await new MercadoLivreClient(http as never).getItems('private',['MLB1']);
    expect(http.get.mock.calls[0][0]).toBe('https://api.mercadolibre.com/items/bulk');
    expect(http.get.mock.calls[0][1].params).toEqual({ids:'MLB1',include_attributes:'all'});
  });
  it('reads the seller automation list with pagination rather than interpreting absence as a permission failure',async()=>{const http={get:jest.fn().mockReturnValueOnce(of({data:{items:['MLB1'],paging:{total:2,offset:0,limit:100}}})).mockReturnValueOnce(of({data:{items:['MLB2'],paging:{total:2,offset:1,limit:100}}}))};const client=new MercadoLivreClient(http as never);expect(await client.getSellerPriceAutomationItems('private','123')).toEqual(['MLB1','MLB2']);expect(http.get.mock.calls[0][0]).toBe('https://api.mercadolibre.com/pricing-automation/users/123/items');expect(http.get.mock.calls[1][1].params.offset).toBe(1);});
  it('does not report absence from an incomplete seller list',async()=>{const http={get:jest.fn().mockReturnValue(of({data:{items:[],paging:{total:2,offset:0,limit:100}}}))};await expect(new MercadoLivreClient(http as never).getSellerPriceAutomationItems('private','123')).rejects.toThrow('Incomplete');});
  it('distinguishes an absent fiscal SKU from other 404 resources',async()=>{const absent={response:{status:404,data:{message:'Sku not found by sku: 44866.13 and caller.id: 7',error_code:'404 NOT_FOUND'}}};const other={response:{status:404,data:{message:'Fiscal endpoint missing',error_code:'resource_not_found'}}};const http={get:jest.fn().mockReturnValueOnce(throwError(()=>absent)).mockReturnValueOnce(throwError(()=>other))};const client=new MercadoLivreClient(http as never);expect(await client.getFiscalBySku('private','44866.13')).toBeNull();expect(http.get.mock.calls[0][0]).toBe('https://api.mercadolibre.com/items/fiscal_information/44866.13');await expect(client.getFiscalBySku('private','44866.13')).rejects.toEqual(other);});
  it('can retry a timed out GET with more time without submitting an alteration',async()=>{const http={get:jest.fn().mockReturnValueOnce(throwError(()=>({code:'ECONNABORTED'}))).mockReturnValueOnce(of({data:{id:'MLB1'}})),put:jest.fn(),post:jest.fn()};const client=new MercadoLivreClient(http as never);expect(await client.getItem('token','MLB1')).toEqual({id:'MLB1'});expect(http.get).toHaveBeenCalledTimes(2);expect(http.get.mock.calls.every(call=>call[1].timeout===60000)).toBe(true);expect(http.put).not.toHaveBeenCalled();expect(http.post).not.toHaveBeenCalled();});
  it('deletes automation once with authentication and does not treat missing permission as absent automation',async()=>{
    const http={delete:jest.fn().mockReturnValue(of({data:null})),get:jest.fn().mockReturnValue(throwError(()=>({response:{status:412,data:{error:'user_not_authorized'}}})))};
    const client=new MercadoLivreClient(http as any);await client.removePriceAutomation('token','MLB1');
    expect(http.delete.mock.calls[0][0]).toBe('https://api.mercadolibre.com/pricing-automation/items/MLB1/automation');expect(http.delete.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
    await expect(client.getPriceAutomation('token','MLB1',true)).rejects.toEqual(expect.objectContaining({response:expect.objectContaining({status:412})}));
    http.delete.mockReturnValue(throwError(()=>new Error('timeout')));await expect(client.removePriceAutomation('token','MLB1')).rejects.toThrow('timeout');expect(http.delete).toHaveBeenCalledTimes(2);
  });
  it('reads prices and posts standard prices once without retrying an ambiguous write',async()=>{
    const http={get:jest.fn().mockReturnValue(of({data:{prices:[]}})),post:jest.fn().mockReturnValue(of({data:{id:'MLB1'}}))};
    const client=new MercadoLivreClient(http as any);await client.getItemPrices('token','MLB1');
    const prices=[{amount:299.9,currency_id:'BRL',conditions:{context_restrictions:['channel_marketplace']}}];await client.updateStandardPrices('token','MLB1',prices);
    expect(http.get.mock.calls[0][0]).toBe('https://api.mercadolibre.com/items/MLB1/prices');expect(http.post.mock.calls[0][0]).toBe('https://api.mercadolibre.com/items/MLB1/prices/standard');expect(http.post.mock.calls[0][1]).toEqual({prices});
    http.post.mockReturnValue(throwError(()=>new Error('timeout')));await expect(client.updateStandardPrices('token','MLB1',prices)).rejects.toThrow('timeout');expect(http.post).toHaveBeenCalledTimes(2);
  });
  it('enforces the standard chart name instead of a caller supplied custom name',async()=>{
    const http={post:jest.fn().mockReturnValue(of({data:{id:'chart'}}))};const client=new MercadoLivreClient(http as never);
    await client.createSizeChart('token','Polo Levis Housemark',{names:{MLB:'Nome fora do padrão'},site_id:'MLB',rows:[]});
    expect(http.post.mock.calls[0][0]).toBe('https://api.mercadolibre.com/catalog/charts');
    expect(http.post.mock.calls[0][1].names.MLB).toMatch(/^Polo Levis Housemark \d{2} \d{2} \d{4}$/);
  });
  it('initializes new warehouse stock with a conditional PUT at version zero',async()=>{
    const http={put:jest.fn().mockReturnValue(of({data:{id:'MLBU22'}}))};const client=new MercadoLivreClient(http as never);
    const location={store_id:'store',network_node_id:'node',quantity:5};await client.initializeWarehouseStock('token','MLBU22',location);
    expect(http.put.mock.calls[0][0]).toBe('https://api.mercadolibre.com/user-products/MLBU22/stock/type/seller_warehouse');
    expect(http.put.mock.calls[0][1]).toEqual({locations:[location]});expect(http.put.mock.calls[0][2].headers['x-version']).toBe('0');
  });
  it('adds a variant to the existing family without calling item publication endpoints', async () => {
    const http={post:jest.fn().mockReturnValue(of({data:{id:'MLBU123'}}))};
    const client=new MercadoLivreClient(http as never);
    const body={attributes:[{id:'COLOR',values:[{name:'Cinza'}]}],pictures:[{id:'999-MLB123_012026'}]};
    await client.addFamilyUserProduct('token','456',body);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post.mock.calls[0][0]).toBe('https://api.mercadolibre.com/user-products-families/456/user-products');
    expect(http.post.mock.calls[0][1]).toBe(body);
  });
  it('uses multiget in chunks of 20', async () => {
    const http = { get: jest.fn().mockImplementation((_url:any,config:any)=>of({data:config.params.ids.split(',').map((id:string)=>({status:200,body:{id}}))})) };
    const client = new MercadoLivreClient(http as never);
    await client.getItems('token', Array.from({ length: 25 }, (_, index) => `MLB${index}`));
    expect(http.get).toHaveBeenCalledTimes(2);
  });
  it('does not retry writes after an ambiguous timeout', async () => {
    const http={put:jest.fn().mockReturnValue(throwError(()=>new Error('timeout')))};
    const client=new MercadoLivreClient(http as never);
    await expect(client.updateItem('token','MLB123',{price:120})).rejects.toThrow('timeout');
    expect(http.put).toHaveBeenCalledTimes(1);
  });
  it('recognizes an absent automation but propagates unknown automation failures', async () => {
    const http={get:jest.fn().mockReturnValueOnce(throwError(()=>({response:{status:404,data:{error:'automation_not_found'}}})))
      .mockReturnValueOnce(throwError(()=>({response:{status:403,data:{error:'unauthorized'}}})))};
    const client=new MercadoLivreClient(http as never);
    expect(await client.getPriceAutomation('token','MLB123')).toBeNull();
    await expect(client.getPriceAutomation('token','MLB123')).rejects.toEqual(expect.objectContaining({response:expect.objectContaining({status:403})}));
  });
});
