import { throwError } from 'rxjs';
import { BlingAuthService } from '../src/bling/bling-auth.service';
describe('Bling renewal failure context',()=>{
 it('identifies the selected store without exposing a provider response',async()=>{
 const db:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'store',name:'Loja Teste',accessToken:'old',refreshToken:'private'}),findUniqueOrThrow:jest.fn().mockResolvedValue({refreshToken:'private'}),update:jest.fn()},$queryRaw:jest.fn()};db.$transaction=jest.fn((fn:any)=>fn(db));
 const http:any={post:jest.fn().mockReturnValue(throwError(()=>new Error('PRIVATE_SECRET')))};
 const auth=new BlingAuthService(db,http,{get:()=> 'configured'} as any);
 await expect(auth.refreshAccess('store')).rejects.toThrow('Reconecte o Bling da loja Loja Teste');expect(db.marketplaceAccount.update).not.toHaveBeenCalled();
 });
});
