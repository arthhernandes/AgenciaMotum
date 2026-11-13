import { delay, of, throwError } from 'rxjs';
import { MercadoLivreAuthService } from '../src/mercadolivre/auth/mercadolivre-auth.service';

describe('Mercado Livre automatic token renewal',()=>{
  it('rejects missing Outlet4u app credentials before building an invalid authorization',async()=>{
    const prisma:any={marketplaceAccount:{findUniqueOrThrow:jest.fn().mockResolvedValue({businessKey:'outlet4u'})}};
    const service=new MercadoLivreAuthService({} as any,{get:()=>''} as any,prisma);
    await expect(service.accountConfig('outlet')).rejects.toMatchObject({response:{code:'MELI_OAUTH_NOT_CONFIGURED'}});
  });
  function setup(){
    const account:any={id:'ml',businessKey:'mottum',accessToken:'old-access',refreshToken:'old-refresh',tokenExpiresAt:new Date(Date.now()-1000)};
    const model={findUniqueOrThrow:jest.fn(async()=>({...account})),update:jest.fn(async({data})=>{Object.assign(account,data);return {...account};})};
    const tx={$queryRaw:jest.fn(),marketplaceAccount:model};
    let tail=Promise.resolve();
    const prisma:any={marketplaceAccount:model,$transaction:jest.fn((callback:any)=>{const result=tail.then(()=>callback(tx));tail=result.then(()=>undefined,()=>undefined);return result;})};
    const http={post:jest.fn().mockReturnValue(of({data:{access_token:'new-access',refresh_token:'rotated-refresh',expires_in:21600,user_id:123}}).pipe(delay(5)))};
    const config={get:(key:string)=>key.includes('SECRET')?'secret':key.includes('CLIENT_ID')?'client':'https://example.test/callback'};
    const create=()=>new MercadoLivreAuthService(http as any,config as any,prisma);
    return {account,model,tx,prisma,http,create};
  }
  it('automatically rotates and persists an expired credential',async()=>{
    const f=setup();expect(await f.create().getValidAccessToken('ml')).toBe('new-access');
    expect(f.account.refreshToken).toBe('rotated-refresh');expect(f.tx.$queryRaw).toHaveBeenCalled();
    expect(String(f.http.post.mock.calls[0][1])).toContain('refresh_token=old-refresh');
  });
  it('does not renew an access token that is still valid',async()=>{
    const f=setup();f.account.tokenExpiresAt=new Date(Date.now()+3600000);
    expect(await f.create().getValidAccessToken('ml')).toBe('old-access');expect(f.http.post).not.toHaveBeenCalled();
  });
  it('shares one renewal across concurrent requests in the same process',async()=>{
    const f=setup();const service=f.create();expect(await Promise.all(Array.from({length:12},()=>service.getValidAccessToken('ml')))).toEqual(Array(12).fill('new-access'));
    expect(f.http.post).toHaveBeenCalledTimes(1);
  });
  it('rechecks under the database lock across separate service instances',async()=>{
    const f=setup();const services=[f.create(),f.create(),f.create()];
    expect(await Promise.all(services.map(service=>service.getValidAccessToken('ml',true)))).toEqual(Array(3).fill('new-access'));
    expect(f.http.post).toHaveBeenCalledTimes(1);expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
  });
  it('does not erase saved credentials when the provider rejects renewal',async()=>{
    const f=setup();f.http.post.mockReturnValue(throwError(()=>({response:{status:400,data:{error:'invalid_grant'}}})));
    await expect(f.create().getValidAccessToken('ml')).rejects.toMatchObject({response:{status:400}});
    expect(f.model.update).not.toHaveBeenCalled();expect(f.account.refreshToken).toBe('old-refresh');
  });
  it('does not overwrite credentials with an incomplete provider response',async()=>{
    const f=setup();f.http.post.mockReturnValue(of({data:{access_token:'incomplete',expires_in:21600}}) as any);
    await expect(f.create().getValidAccessToken('ml')).rejects.toThrow('Invalid Mercado Livre token response');expect(f.model.update).not.toHaveBeenCalled();
  });
  it('accepts a numeric validity period serialized as text',async()=>{
    const f=setup();f.http.post.mockReturnValue(of({status:200,data:{access_token:'new-access',refresh_token:'rotated-refresh',expires_in:'21600'}}) as any);
    expect(await f.create().getValidAccessToken('ml')).toBe('new-access');
    expect(f.account.refreshToken).toBe('rotated-refresh');
    expect(f.account.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now()+21000000);
  });
  it('connects a valid authorization without refresh token and reports renewal unavailable',async()=>{
    const f=setup();f.http.post.mockReturnValue(of({status:200,data:{access_token:'authorized',expires_in:21600}}) as any);
    expect(await f.create().exchangeCode('ml','one-time-code')).toMatchObject({connected:true,automaticRenewal:false});
    expect(f.account.accessToken).toBe('authorized');expect(f.account.refreshToken).toBeNull();
  });
  it('recovers a newly authorized credential instead of requiring reconnection after an old renewal fails',async()=>{
    const f=setup();f.http.post.mockImplementation(()=>{Object.assign(f.account,{accessToken:'reconnected',refreshToken:'reconnected-refresh',tokenExpiresAt:new Date(Date.now()+3600000)});return throwError(()=>({response:{status:400,data:{error:'invalid_grant'}}}));});
    expect(await f.create().getValidAccessToken('ml')).toBe('reconnected');expect(f.model.update).not.toHaveBeenCalled();
  });
});
