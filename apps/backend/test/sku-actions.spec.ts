import { SkuActionsService } from '../src/listing-links/sku-actions.service';
describe('Account-scoped actions by parent SKU',()=>{
  const product={id:'p1',sku:'54446',title:'Polo',variants:[{id:'pv1',sku:'54446.1'}]};
  function listing(id:string,sku:string,family?:string){return {id,itemId:id,marketplaceAccountId:'ml1',title:'Polo',status:'active',price:100,availableQuantity:1,soldQuantity:0,rawData:{...(family?{family_id:family}:{})},variants:[{id:'v'+id,variationId:'1',sku,rawData:{}}],links:[]};}
  function setup(){const prisma:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'bling1',businessKey:'mottum'})},product:{findMany:jest.fn().mockResolvedValue([product])},marketplaceListing:{findMany:jest.fn().mockResolvedValue([listing('MLB1','54446.1'),listing('MLB2','OTHER')])}};return {prisma,service:new SkuActionsService(prisma)};}
  it('resolves the parent catalog and only matches exact child SKUs in the selected business',async()=>{
    const f=setup();const result=await f.service.find('bling1',['54446']);
    expect(result.rows[0].announcements.map(ad=>ad.reference)).toEqual(['MLB1']);
    expect(f.prisma.product.findMany.mock.calls[0][0].where.blingAccountId).toBe('bling1');
    expect(f.prisma.marketplaceListing.findMany.mock.calls[0][0].where.marketplaceAccount.businessKey).toBe('mottum');
  });
  it('finds a manually linked listing even when its current seller SKU differs',async()=>{
    const f=setup();const ad:any=listing('MLB3','OLD');ad.links=[{productId:'p1'}];f.prisma.marketplaceListing.findMany.mockResolvedValue([ad]);
    expect((await f.service.find('bling1',['54446'])).rows[0].announcements[0].reference).toBe('MLB3');
  });
  it('groups offers from the same family once',async()=>{
    const f=setup();f.prisma.marketplaceListing.findMany.mockResolvedValue([listing('MLB1','54446.1','family1'),listing('MLB2','54446.1','family1')]);
    const result=await f.service.find('bling1',['54446']);expect(result.rows[0].announcements).toHaveLength(1);expect(result.rows[0].announcements[0].items).toEqual(['MLB1','MLB2']);
  });
  it('reports unknown parents instead of inferring them from a partial SKU',async()=>{
    const f=setup();const result=await f.service.find('bling1',['544']);expect(result.rows[0].found).toBe(false);expect(result.rows[0].announcements).toEqual([]);
  });
  it('rejects missing account context before reading a catalog',async()=>{
    const f=setup();f.prisma.marketplaceAccount.findFirst.mockResolvedValue(null);await expect(f.service.find('other',['54446'])).rejects.toThrow('Selecione');expect(f.prisma.product.findMany).not.toHaveBeenCalled();
  });
  it('flags an announcement linked to more than one requested parent',async()=>{
    const f=setup();f.prisma.product.findMany.mockResolvedValue([product,{...product,id:'p2',sku:'56926'}]);
    const ad:any=listing('MLB1','OLD');ad.links=[{productId:'p1'},{productId:'p2'}];f.prisma.marketplaceListing.findMany.mockResolvedValue([ad]);
    const result=await f.service.find('bling1',['54446','56926']);expect(result.rows.every(row=>row.announcements[0].conflict)).toBe(true);
  });
});
