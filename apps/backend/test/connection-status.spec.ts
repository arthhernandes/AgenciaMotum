import { ConnectionStatusService } from '../src/marketplace-accounts/connection-status.service';
import { MarketplaceAccountsService } from '../src/marketplace-accounts/marketplace-accounts.service';

describe('Verified marketplace connection status',()=>{
  const account={id:'ml',sellerId:'123',active:true,accessToken:'private-access',refreshToken:'private-refresh'};
  function setup() {
    const auth={getValidAccessToken:jest.fn().mockResolvedValue('private-access')};
    const client={getAuthenticatedSeller:jest.fn().mockResolvedValue({id:123})};
    return {auth,client,service:new ConnectionStatusService(auth as never,client as never)};
  }
  it('requires a live successful identity check before reporting connected',async()=>{
    const {service,client}=setup();
    const result=await service.verify(account);
    expect(result.connected).toBe(true);expect(result.connectionStatus).toBe('CONNECTED');
    expect(client.getAuthenticatedSeller).toHaveBeenCalledWith('private-access');
    expect(result.connectionCheckedAt).toBeTruthy();
  });
  it('renews once after a rejected token and verifies the renewed identity',async()=>{
    const {service,client,auth}=setup();
    auth.getValidAccessToken.mockResolvedValueOnce('old').mockResolvedValueOnce('renewed');
    client.getAuthenticatedSeller.mockRejectedValueOnce({response:{status:401}}).mockResolvedValueOnce({id:123});
    expect((await service.verify(account)).connected).toBe(true);
    expect(auth.getValidAccessToken).toHaveBeenLastCalledWith('ml',true);
    expect(client.getAuthenticatedSeller).toHaveBeenLastCalledWith('renewed');
  });
  it('explains when a legacy credential lacks the renewal token',async()=>{
    const {service,client,auth}=setup();client.getAuthenticatedSeller.mockRejectedValue({response:{status:401}});
    const result=await service.verify({...account,refreshToken:null});
    expect(result.connectionMessage).toContain('sem token de renovação');
    expect(auth.getValidAccessToken).toHaveBeenCalledTimes(1);
  });
  it('requires reconnection only if renewed authorization is rejected',async()=>{
    const {service,client}=setup();client.getAuthenticatedSeller.mockRejectedValue({response:{status:401}});
    expect(await service.verify(account)).toEqual(expect.objectContaining({connected:false,connectionStatus:'REAUTH_REQUIRED',connectionHttpStatus:401}));
    expect(client.getAuthenticatedSeller).toHaveBeenCalledTimes(2);
  });
  it('distinguishes denied permission from invalid authorization and does not refresh on 403',async()=>{
    const {service,client,auth}=setup();client.getAuthenticatedSeller.mockRejectedValue({response:{status:403}});
    const result=await service.verify(account);
    expect(result.connectionStatus).toBe('ACCESS_DENIED');expect(result.connected).toBe(false);
    expect(auth.getValidAccessToken).toHaveBeenCalledTimes(1);
    expect(result.connectionMessage).not.toContain('Reconecte');
  });
  it('does not promise that reconnecting alone enables automatic renewal',async()=>{
    const {service,client}=setup();client.getAuthenticatedSeller.mockRejectedValue({response:{status:401}});
    const result=await service.verify({...account,refreshToken:null});
    expect(result.connectionMessage).toContain('offline_access');
    expect(result.connectionMessage).toContain('Reconectar sem essa permissão mantém o acesso temporário');
  });
  it('rejects an authorization belonging to a different seller',async()=>{
    const {service,client}=setup();client.getAuthenticatedSeller.mockResolvedValue({id:999});
    expect((await service.verify(account)).connectionStatus).toBe('ACCOUNT_MISMATCH');
  });
  it.each([429,500,undefined])('does not report a transient failure as a revoked token (%s)',async status=>{
    const {service,client}=setup();client.getAuthenticatedSeller.mockRejectedValue({response:{status}});
    expect((await service.verify(account)).connectionStatus).toBe('VERIFICATION_UNAVAILABLE');
  });
  it('distinguishes an invalid refresh grant from a temporary refresh error',async()=>{
    const {service,auth}=setup();auth.getValidAccessToken.mockRejectedValue({response:{status:400,data:{error:'invalid_grant'}}});
    expect((await service.verify(account)).connectionStatus).toBe('REAUTH_REQUIRED');
    auth.getValidAccessToken.mockRejectedValue({response:{status:500}});
    expect((await service.verify(account)).connectionStatus).toBe('VERIFICATION_UNAVAILABLE');
  });
  it('does not recommend reconnecting a seller to fix invalid application credentials',async()=>{
    const {service,auth}=setup();auth.getValidAccessToken.mockRejectedValue({response:{status:401,data:{error:'invalid_client'}}});
    expect((await service.verify(account)).connectionStatus).toBe('CONFIGURATION_ERROR');
  });
  it('does not probe accounts without credentials or inactive accounts',async()=>{
    const {service,auth}=setup();
    expect((await service.verify({...account,accessToken:null,refreshToken:null})).connectionStatus).toBe('NOT_CONNECTED');
    expect((await service.verify({...account,active:false})).connectionStatus).toBe('INACTIVE');
    expect(auth.getValidAccessToken).not.toHaveBeenCalled();
  });
  it('returns sanitized, verified account information from both account endpoints',async()=>{
    const raw={...account,marketplace:'MERCADO_LIVRE',name:'Motum'};
    const prisma={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({businessKey:'mottum'}),findMany:jest.fn().mockResolvedValue([raw]),findUnique:jest.fn().mockResolvedValue(raw)}};
    const verify=jest.fn().mockResolvedValue({connected:false,connectionStatus:'ACCESS_DENIED'});
    const service=new MarketplaceAccountsService(prisma as never,{verify} as never);
    const rows=await service.findAll('bling-mottum');const row=await service.findOne('ml');
    expect(prisma.marketplaceAccount.findMany.mock.calls[0][0].where.businessKey).toBe('mottum');
    expect(rows[0].connected).toBe(false);expect(row?.connected).toBe(false);
    expect(JSON.stringify({rows,row})).not.toContain('private-');
    expect(rows[0].hasCredentials).toBe(true);
  });
});
