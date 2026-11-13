import { ChatMarketplaceService } from '../src/chat/chat-marketplace.service';

it('persists the exact observed SELLER_SKU and current variant attributes after a correction', async () => {
  const prisma:any={marketplaceListing:{upsert:jest.fn().mockResolvedValue({id:'listing1'})},marketplaceListingVariant:{upsert:jest.fn(),deleteMany:jest.fn()}};
  const service=new ChatMarketplaceService(prisma,{} as any,{} as any);
  const variation={id:10,seller_custom_field:'',attributes:[{id:'SELLER_SKU',value_name:'56926.1'}],attribute_combinations:[{id:'COLOR',value_name:'Água'},{id:'SIZE',value_name:'G'}]};
  await (service as any).saveLocal({id:'account1'},{id:'MLB1',variations:[variation]});
  expect(prisma.marketplaceListingVariant.upsert.mock.calls[0][0].update).toMatchObject({sku:'56926.1',attributes:{attribute_combinations:variation.attribute_combinations,attributes:variation.attributes}});
  expect(prisma.marketplaceListingVariant.deleteMany).toHaveBeenCalledWith({where:{listingId:'listing1',variationId:{notIn:['10']}}});
});
