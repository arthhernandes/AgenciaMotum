import { redactCosts } from '../src/auth/cost-visibility';
import { assertRoutePermissions, defaultPermissions, effectivePermissions } from '../src/auth/permissions';

describe('Product cost visibility',()=>{
  it('requires explicit permission for non-administrators, including profile defaults',()=>{
    for(const role of ['VIEWER','CONSULTANT'])expect(defaultPermissions(role)).not.toContain('costs.view');
    expect(effectivePermissions({role:'ADMIN',permissions:[]})).toContain('costs.view');
  });
  it('blocks the cost endpoint even for a user who can manage listings',()=>{
    expect(()=>assertRoutePermissions({role:'CONSULTANT',permissions:['listings.view','listings.manage','map.view']},'POST','/api/products/product/costs')).toThrow();
    expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['map.view','costs.view']},'POST','/api/products/product/costs')).not.toThrow();
  });
  it('requires cost visibility for the complete fiscal review',()=>{
    expect(()=>assertRoutePermissions({role:'CONSULTANT',permissions:['listings.manage']},'POST','/api/chat/listing-fiscal')).toThrow();
    expect(()=>assertRoutePermissions({role:'CONSULTANT',permissions:['listings.manage','costs.view']},'GET','/api/chat/actions/action/fiscal')).not.toThrow();
  });
  it('removes nested costs and fiscal preview fields without changing sale prices',()=>{
    const source={price:199.9,rows:[{sku:'5586.42',cost:45.9,values:{ncm:'61091000',cost:'45.90'},current:{cost:40},fields:[{field:'Preço',before:180,after:199.9},{field:'Custo de aquisição (R$)',before:40,after:45.9}]}]};
    const result=redactCosts(source);expect(result.price).toBe(199.9);expect(result.rows[0]).not.toHaveProperty('cost');expect(result.rows[0].values).toEqual({ncm:'61091000'});expect(result.rows[0].current).toEqual({});expect(result.rows[0].fields).toEqual([{field:'Preço',before:180,after:199.9}]);expect(source.rows[0].cost).toBe(45.9);
  });
  it('removes previously saved cost disclosures from conversations and tool context',()=>{
    const result=redactCosts({content:'O custo deste SKU é R$ 45,90.',toolContext:[{output:'{"cost":45.9,"sku":"5586.42"}'}],message:'Preço de venda: R$ 199,90'});
    expect(JSON.stringify(result)).not.toMatch(/45[,.]9/);expect(result.message).toContain('199,90');
  });
  it('redacts an unlabelled answer when its saved tool context contains costs',()=>{
    const message={role:'assistant',content:'O valor consultado foi R$ 45,90.',toolContext:[{output:'{"cost":45.9}'}]};
    expect(redactCosts(message).content).toBe('Informação de custo restrita.');
  });
});
