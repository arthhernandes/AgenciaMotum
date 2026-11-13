import { of, throwError } from 'rxjs';
import { BlingAuthService } from '../src/bling/bling-auth.service';
const config:any={get:(key:string,fallback:string)=>({BLING_CLIENT_ID:'client',BLING_CLIENT_SECRET:'secret',BLING_REDIRECT_URI:'https://example.test/callback'} as Record<string,string>)[key]??fallback};
export function fixture(){
 const account={id:'store-a',name:'Loja A',accessToken:'old-access',refreshToken:'old-refresh'};
 const db:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue(account),findUniqueOrThrow:jest.fn().mockResolvedValue(account),update:jest.fn()},$queryRaw:jest.fn()};
 db.$transaction=jest.fn((fn:any)=>fn(db));
 const http:any={post:jest.fn().mockReturnValue(of({data:{access_token:'new',refresh_token:'rotated',expires_in:3600}}))};
 return {db,http,service:new BlingAuthService(db,http,config)};
}
describe('Bling token renewal',()=>{
 it('uses Basic app authentication and persists rotated tokens on the same store',async()=>{const f=fixture();expect(await f.service.refreshAccess('store-a')).toBe('new');expect(f.http.post.mock.calls[0][2].headers.Authorization).toBe('Basic '+Buffer.from('client:secret').toString('base64'));expect(f.http.post.mock.calls[0][1].has('client_secret')).toBe(false);expect(f.db.marketplaceAccount.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:'store-a'},data:expect.objectContaining({accessToken:'new',refreshToken:'rotated'})}));});
 it('shares concurrent renewals of the same store',async()=>{const f=fixture();await Promise.all([f.service.refreshAccess('store-a'),f.service.refreshAccess('store-a')]);expect(f.http.post).toHaveBeenCalledTimes(1);});
 it('rejects malformed tokens without persisting credentials',async()=>{const f=fixture();f.http.post.mockReturnValue(of({data:{access_token:'incomplete'}}));await expect(f.service.refreshAccess('store-a')).rejects.toThrow('Reconecte');expect(f.db.marketplaceAccount.update).not.toHaveBeenCalled();});
 it('rejects an unknown store before exchanging a code',async()=>{const f=fixture();f.db.marketplaceAccount.findFirst.mockResolvedValue(null);await expect(f.service.exchangeCode('code','unknown')).rejects.toThrow('Loja não encontrada');expect(f.http.post).not.toHaveBeenCalled();});
 it('saves authorization only for the chosen store',async()=>{const f=fixture();await f.service.exchangeCode('code','store-a');expect(f.db.marketplaceAccount.update.mock.calls[0][0].where).toEqual({id:'store-a'});expect(f.http.post.mock.calls[0][1].get('grant_type')).toBe('authorization_code');});
});
