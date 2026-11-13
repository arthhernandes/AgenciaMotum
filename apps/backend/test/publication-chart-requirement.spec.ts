import { ChatFamilyPublicationService } from '../src/chat/chat-family-publication.service';
import { ChatFamilyVariants } from '../src/chat/chat-family-variants';

describe('Publication chart requirements by category',()=>{
 afterEach(()=>jest.restoreAllMocks());
 function setup(required=false){
  const row={id:'v',productId:'p',sku:'2469.0020',color:'Vermelho',size:'Unico'};
  const model={attributes:['HEIGHT','LENGTH','WIDTH','WEIGHT'].map(id=>({id:'SELLER_PACKAGE_'+id,values:[{name:'1'}]})),pictures:[{id:'photo'}]};
  jest.spyOn(ChatFamilyVariants.prototype,'inspect').mockResolvedValue({model,family:{family_id:'family',child_attributes_ids:['COLOR','SIZE']}} as any);
  const prisma:any={user:{findUnique:jest.fn().mockResolvedValue({active:true,role:'ADMIN'})},marketplaceListing:{findFirst:jest.fn().mockResolvedValue({marketplaceAccount:{id:'ml',sellerId:'123'}})},productVariant:{findUnique:jest.fn().mockResolvedValue(row),findMany:jest.fn().mockResolvedValue([row])}};
  const client:any={getSizeChartDomains:jest.fn().mockResolvedValue({domains:[]}),getItem:jest.fn().mockResolvedValue({id:'MLB1',seller_id:123,category_id:'MLB430275',domain_id:'MLB-HATS_AND_CAPS',attributes:[{id:'SELLER_SKU',value_name:'2469.0009'}]}),getCategoryAttributeDefinitions:jest.fn().mockResolvedValue(required?[{id:'SIZE_GRID_ID',tags:{required:true}}]:[]),getWarehouses:jest.fn().mockResolvedValue([{id:'store',user_id:123,status:'active',tags:['stock_location'],network_node_id:'node'}]),getSizeChart:jest.fn()};
  return {client,service:new ChatFamilyPublicationService(prisma,{getValidAccessToken:jest.fn().mockResolvedValue('private')} as any,client,{} as any)};
 }
 const args={anuncio:'MLB1',preco:182.77,skus:['2469.0020'],fotos_modelo_confirmadas:true,publicar_com_saldo:true};
 it('prepares caps without chart attributes when the category does not require them',async()=>{
  const {service,client}=setup();const plan=await service.prepare({id:'bling',businessKey:'mottum'},'user',args);
  expect(plan.sizeChart).toBeUndefined();expect(plan.rows[0].publicationAttributes?.map(a=>a.id)).not.toContain('SIZE_GRID_ID');
  expect(client.getSizeChart).not.toHaveBeenCalled();expect(plan.rows[0].sku).toBe('2469.0020');
 });
 it('still blocks categories that require charts',async()=>{
  const {service}=setup(true);await expect(service.prepare({id:'bling',businessKey:'mottum'},'user',args)).rejects.toThrow('Esta categoria exige');
 });
 it('does not treat a failed category lookup as permission to omit a chart',async()=>{
  const {service,client}=setup();client.getCategoryAttributeDefinitions.mockRejectedValue(new Error('Unavailable'));
  await expect(service.prepare({id:'bling',businessKey:'mottum'},'user',args)).rejects.toThrow('Unavailable');
 });
});
