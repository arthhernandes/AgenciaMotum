import {sizeChartPolicy} from '../src/chat/size-chart-policy';
describe('Dynamic size chart policy',()=>{
 const item:any={category_id:'category',domain_id:'MLB-TEST'};
 const client=(attributes:any[],domains:any[]=[])=>({getCategoryAttributeDefinitions:jest.fn().mockResolvedValue(attributes),getSizeChartDomains:jest.fn().mockResolvedValue({domains})}) as any;
 it('identifies categories outside the active chart domains',async()=>{
  expect(await sizeChartPolicy(client([]),'token',item)).toMatchObject({supported:false,required:false,status:'NOT_APPLICABLE'});
 });
 it('distinguishes optional chart support from mandatory charts',async()=>{
  expect(await sizeChartPolicy(client([{id:'SIZE_GRID_ID',tags:{}}],[{domain_id:'TEST'}]),'token',item)).toMatchObject({supported:true,required:false,status:'SUPPORTED'});
 });
 it.each([{required:true},{conditional_required:true},['required'],['conditional_required']])('accepts both tag formats for required chart attributes',async tags=>{
  expect(await sizeChartPolicy(client([{id:'SIZE_GRID_ROW_ID',tags}]),'token',item)).toMatchObject({supported:true,required:true,status:'REQUIRED'});
 });
 it('does not confuse chart template filters with chart requirement',async()=>{
  expect((await sizeChartPolicy(client([{id:'GENDER',tags:{grid_template_required:true,required:true}}]),'token',item)).required).toBe(false);
 });
 it('rejects incomplete provider responses instead of treating them as exemptions',async()=>{
  const api=client([]);api.getSizeChartDomains.mockResolvedValue({});await expect(sizeChartPolicy(api,'token',item)).rejects.toThrow('confirmar');
 });
});
