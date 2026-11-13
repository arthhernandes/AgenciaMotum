import { ListingPricesService } from '../src/listings/listing-prices.service';
import { FinanceApi } from '../src/reports/finance-api';
describe('Listing promotional prices',()=>{
 afterEach(()=>jest.restoreAllMocks());
 function setup(){const prisma:any={marketplaceAccount:{findFirst:jest.fn(async()=>({id:'bling',marketplace:'BLING',businessKey:'x'}))},marketplaceListing:{findMany:jest.fn(async()=>[{itemId:'MLB1',marketplaceAccountId:'ml'}])},integrationSnapshot:{findUnique:jest.fn(async()=>null),upsert:jest.fn(async()=>({}))}};return {prisma,service:new ListingPricesService(prisma,{} as any)};}
 it('reads the winning marketplace price and detects an active discount',async()=>{const f=setup(),get=jest.spyOn(FinanceApi.prototype,'get').mockResolvedValue({amount:305.99,regular_amount:399.99,currency_id:'BRL'});expect((await f.service.find('bling',['MLB1'])).items[0]).toMatchObject({itemId:'MLB1',amount:305.99,promotional:true});expect(get).toHaveBeenCalledWith('/items/MLB1/sale_price',{context:'channel_marketplace'});});
 it('does not fabricate a discount after a failed query',async()=>{const f=setup();jest.spyOn(FinanceApi.prototype,'get').mockRejectedValue(Error('unavailable'));expect((await f.service.find('bling',['MLB1'])).items[0]).toMatchObject({amount:null,promotional:null});expect(f.prisma.integrationSnapshot.upsert).not.toHaveBeenCalled();});
 it('rejects items outside the selected account',async()=>{const f=setup();await expect(f.service.find('bling',['MLB2'])).rejects.toThrow('conta selecionada');});
 it('accepts a confirmed standard price without a promotion',async()=>{const f=setup();jest.spyOn(FinanceApi.prototype,'get').mockResolvedValue({amount:100,regular_amount:null,currency_id:'BRL'});expect((await f.service.find('bling',['MLB1'])).items[0]).toMatchObject({amount:100,promotional:false});});
});
