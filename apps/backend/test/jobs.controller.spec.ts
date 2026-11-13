import { JobsController } from '../src/jobs/jobs.controller';

describe('Selected account listing synchronization', () => {
  it('starts a background synchronization for the selected Mercado Livre business',async()=>{
    const sync={startBackground:jest.fn().mockResolvedValue({id:'execution'})};const findFirst=jest.fn().mockResolvedValueOnce({businessKey:'mottum'}).mockResolvedValueOnce({id:'meli-mottum'});
    const controller=new JobsController(sync as never,{marketplaceAccount:{findFirst}} as never,{} as never);
    expect(await controller.startSelected('bling-ts-comercio')).toEqual({id:'execution'});expect(sync.startBackground).toHaveBeenCalledWith('meli-mottum');
  });
  it('syncs all items from the Mercado Livre account matching the selected business', async () => {
    const sync = { syncAccount: jest.fn().mockResolvedValue({ processed: 5, errors: [] }) };
    const findFirst = jest.fn().mockResolvedValueOnce({ businessKey: 'mottum' }).mockResolvedValueOnce({ id: 'meli-mottum' });
    const controller = new JobsController(sync as never, { marketplaceAccount: { findFirst } } as never, {} as never);
    await controller.syncSelected('bling-ts-comercio');
    expect(findFirst.mock.calls[1][0].where).toMatchObject({ marketplace: 'MERCADO_LIVRE', businessKey: 'mottum', active: true });
    expect(sync.syncAccount).toHaveBeenCalledWith('meli-mottum');
  });

  it('rejects a missing selected account without starting synchronization', async () => {
    const sync = { syncAccount: jest.fn() };
    const controller = new JobsController(sync as never, {} as never, {} as never);
    await expect(controller.syncSelected()).rejects.toThrow();
    expect(sync.syncAccount).not.toHaveBeenCalled();
  });
});
