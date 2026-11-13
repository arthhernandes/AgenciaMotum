import { MarketplaceAccountsService } from '../src/marketplace-accounts/marketplace-accounts.service';
import { MarketplaceAccountsController } from '../src/marketplace-accounts/marketplace-accounts.controller';

describe('Master administrator stores', () => {
  it('creates an arbitrary store and its pending Mercado Livre account atomically', async () => {
    const tx:any = { marketplaceAccount: { create: jest.fn().mockImplementation(({data}) => Promise.resolve({id:'store',...data})) } };
    const db:any = {$transaction:jest.fn(callback => callback(tx))};
    const service = new MarketplaceAccountsService(db, {} as any);
    expect(await service.createStore(' Minha Loja ')).toEqual({id:'store',displayName:'Minha Loja'});
    const [bling, meli] = tx.marketplaceAccount.create.mock.calls.map(([arg]:any[]) => arg.data);
    expect(bling).toMatchObject({marketplace:'BLING',name:'Minha Loja'});
    expect(meli).toMatchObject({marketplace:'MERCADO_LIVRE',businessKey:bling.businessKey,sellerId:'PENDING_'+bling.businessKey});
    expect(bling).not.toHaveProperty('accessToken');
  });
  it.each(['VIEWER','CONSULTANT'])('rejects store creation by %s even with connection permissions', role => {
    const service:any={createStore:jest.fn()};
    expect(() => new MarketplaceAccountsController(service).createStore({name:'Loja'}, {user:{role}})).toThrow('administrador master');
    expect(service.createStore).not.toHaveBeenCalled();
  });
  it('allows the master to create stores', () => {
    const service:any={createStore:jest.fn().mockResolvedValue({id:'store'})};
    new MarketplaceAccountsController(service).createStore({name:'Loja'}, {user:{role:'ADMIN'}});
    expect(service.createStore).toHaveBeenCalledWith('Loja');
  });
  it('lists arbitrary store names and has no predefined seller IDs', async () => {
    const db:any={marketplaceAccount:{findMany:jest.fn().mockResolvedValue([{id:'1',name:'Loja A'},{id:'2',name:'Minha marca'}])}};
    const result=await new MarketplaceAccountsService(db,{} as any).findBusinessAccounts();
    expect(result).toEqual([{id:'1',displayName:'Loja A'},{id:'2',displayName:'Minha marca'}]);
    expect(db.marketplaceAccount.findMany.mock.calls[0][0].where).toEqual({marketplace:'BLING',active:true});
  });
  it('returns no marketplace accounts without a selected store', async () => {
    expect(await new MarketplaceAccountsService({} as any,{} as any).findAll()).toEqual([]);
  });
});
