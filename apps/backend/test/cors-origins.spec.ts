import { corsOrigins } from '../src/common/cors-origins';
describe('split frontend CORS configuration',()=>{
 it('allows only the configured public frontend origin',()=>expect(corsOrigins('https://consultor.example.com')).toEqual(['https://consultor.example.com']));
 it('supports explicit development and production origins without allowing arbitrary sites',()=>expect(corsOrigins('https://ignored.example','https://consultor.example.com,http://localhost:4200')).toEqual(['https://consultor.example.com','http://localhost:4200']));
 it.each(['https://user:password@example.com','https://example.com/path','https://example.com?token=private','*'])('rejects an invalid origin: %s',value=>expect(()=>corsOrigins(value)).toThrow());
});
