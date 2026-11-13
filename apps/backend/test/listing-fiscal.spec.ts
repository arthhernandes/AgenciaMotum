import { ChatService } from '../src/chat/chat.service';
import { ChatController } from '../src/chat/chat.controller';

describe('Fiscal editor from listings',()=>{
  it('returns a user-scoped NCM suggestion and editable draft without requiring a chat conversation',async()=>{
    const chat:any={analyzeFiscalNcm:jest.fn().mockResolvedValue({message:'Sugestão',actions:[{id:'new-action'}]}),fiscalDraft:jest.fn().mockResolvedValue({approved:false,rows:[]})};
    const controller=new ChatController(chat,{} as any,{} as any);
    const result=await controller.listingNcm('old-action','bling1',{user:{id:'user1'}});
    expect(chat.analyzeFiscalNcm).toHaveBeenCalledWith('old-action','bling1','user1');
    expect(chat.fiscalDraft).toHaveBeenCalledWith('new-action','bling1','user1');
    expect(result).toMatchObject({actionId:'new-action',draft:{approved:false}});
  });
  it('does not load a draft when the suggestion rejects access to the action',async()=>{
    const chat:any={analyzeFiscalNcm:jest.fn().mockRejectedValue(new Error('unavailable')),fiscalDraft:jest.fn()};
    await expect(new ChatController(chat,{} as any,{} as any).listingNcm('foreign','other',{user:{id:'user1'}})).rejects.toThrow('unavailable');
    expect(chat.fiscalDraft).not.toHaveBeenCalled();
  });
  function setup(){
    const account={id:'bling1',businessKey:'mottum',sellerId:'ts_comercio'};
    const fiscal={prepare:jest.fn().mockResolvedValue({reference:'MLB1',rows:[{sku:'100.1',color:'Azul',size:'P',title:'Camisa',values:{ncm:'62052000'}}],approved:false,regime:''}),execute:jest.fn()};
    const market={authorizeFiscal:jest.fn()};
    const service=new ChatService({} as any,{} as any,{user:{findUnique:jest.fn().mockResolvedValue({active:true,role:'ADMIN',permissions:[]})}} as any,{} as any,{} as any,{} as any,{} as any,market as any,undefined,undefined,undefined,fiscal as any);
    jest.spyOn(service as any,'account').mockResolvedValue(account);
    const propose=jest.spyOn(service as any,'propose').mockImplementation(async(...args:any[])=>{args[1].push({id:'fiscal-action'});});
    return {service,fiscal,market,account,propose};
  }
  it('prepares account-scoped data and a review action without writing fiscal information',async()=>{
    const f=setup();const result=await f.service.prepareListingFiscal('bling1','user1','MLB1');
    expect(f.market.authorizeFiscal).toHaveBeenCalledWith('user1');
    expect(f.fiscal.prepare).toHaveBeenCalledWith(f.account,'MLB1',expect.any(Function));
    expect(result.actionId).toBe('fiscal-action');expect(result.draft.approved).toBe(false);
    expect(f.fiscal.execute).not.toHaveBeenCalled();
    expect(f.propose.mock.calls[0][0]).toMatchObject({accountId:'bling1',userId:'user1',kind:'marketplace'});
  });
  it('opens a deterministic editor without invoking an AI classification',async()=>{
    const f=setup();await f.service.prepareListingFiscal('bling1','user1','MLB1');
    expect(await f.fiscal.prepare.mock.calls[0][2]([{sku:'100.1'}])).toEqual([]);
  });
  it('rejects unauthorized users before consulting fiscal data',async()=>{
    const f=setup();f.market.authorizeFiscal.mockRejectedValue(new Error('forbidden'));
    await expect(f.service.prepareListingFiscal('bling1','viewer','MLB1')).rejects.toThrow('forbidden');
    expect(f.fiscal.prepare).not.toHaveBeenCalled();expect(f.propose).not.toHaveBeenCalled();
  });
});
