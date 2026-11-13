import { getBlingOAuthConfig } from '../src/bling/bling-oauth.config';
describe('Bling application configuration', () => {
 const values: Record<string,string> = {BLING_CLIENT_ID:'app',BLING_CLIENT_SECRET:'secret',BLING_REDIRECT_URI:'https://example.test/api/bling/auth/callback'};
 const config:any={get:(key:string,fallback:string)=>values[key]??fallback};
 it('uses one app with an explicit arbitrary store identity',()=>{expect(getBlingOAuthConfig(config,'store-abc')).toMatchObject({account:'store-abc',clientId:'app',tokenUrl:'https://api.bling.com.br/Api/v3/oauth/token'});});
 it('never falls back to a hard-coded business',()=>{expect(()=>getBlingOAuthConfig(config)).toThrow('Selecione uma loja');});
 it('rejects missing app credentials',()=>{expect(()=>getBlingOAuthConfig({get:()=>''} as any,'store')).toThrow('BLING_CLIENT_ID');});
});
