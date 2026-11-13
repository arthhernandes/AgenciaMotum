import { confirmPublicationStatus } from '../src/chat/listing-publication-status';
describe('Publication status confirmation',()=>{
  const item=(status:string,sub_status:string[]=[])=>({id:'MLB1',status,sub_status});
  it('waits for automatic stock activation without forcing an invalid PUT',async()=>{
    const client={getItem:jest.fn().mockResolvedValueOnce(item('paused',['out_of_stock'])).mockResolvedValueOnce(item('active')),updateItem:jest.fn()},wait=jest.fn().mockResolvedValue(undefined);
    expect((await confirmPublicationStatus(client,'token','MLB1','active',wait)).status).toBe('active');expect(wait).toHaveBeenCalledTimes(1);expect(client.updateItem).not.toHaveBeenCalled();
  });
  it('does not turn an unconfirmed stock or moderation status into success',async()=>{
    for(const state of [item('paused',['out_of_stock']),item('under_review',['held'])]){
      const client={getItem:jest.fn().mockResolvedValue(state),updateItem:jest.fn()};
      await expect(confirmPublicationStatus(client,'token','MLB1','active',async()=>{})).rejects.toThrow('foi criado');expect(client.updateItem).not.toHaveBeenCalled();
    }
  });
  it('reads back after a refused transition and accepts only the verified requested status',async()=>{
    const client={getItem:jest.fn().mockResolvedValueOnce(item('paused',['paused_by_seller'])).mockResolvedValueOnce(item('active')),updateItem:jest.fn().mockRejectedValue(new Error('item.status.invalid'))};
    expect((await confirmPublicationStatus(client,'token','MLB1','active')).status).toBe('active');expect(client.updateItem).toHaveBeenCalledTimes(1);
    client.getItem.mockResolvedValue(item('paused',['paused_by_seller']));await expect(confirmPublicationStatus(client,'token','MLB1','active')).rejects.toThrow('item.status.invalid');
  });
  it('preserves intentional pauses and zero-stock offers',async()=>{
    const client={getItem:jest.fn().mockResolvedValueOnce(item('active')).mockResolvedValueOnce(item('paused')),updateItem:jest.fn().mockResolvedValue({})};
    expect((await confirmPublicationStatus(client,'token','MLB1','paused')).status).toBe('paused');expect(client.updateItem).toHaveBeenCalledWith('token','MLB1',{status:'paused'});
  });
});
