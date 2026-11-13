import { ListingsService } from '../src/listings/listings.service';
import { ListingsQuery } from '../src/listings/dto';

describe('Sorting all grouped announcements before pagination',()=>{
  it('ranks by period sales across all groups before selecting the first page',async()=>{
    const db:any={marketplaceAccount:{findMany:jest.fn().mockResolvedValue([])},product:{findMany:jest.fn().mockResolvedValue([])},productVariant:{findMany:jest.fn().mockResolvedValue([])},integrationSnapshot:{findMany:jest.fn().mockResolvedValue([])}};
    const ranking=jest.fn().mockResolvedValue({items:[{itemId:'MLB1',soldQuantity:5,variations:[]},{itemId:'MLB2',soldQuantity:40,variations:[]}]});
    const service=new ListingsService(db,undefined,undefined,{ranking} as any);
    const rows=[1,2].map(n=>({id:String(n),itemId:'MLB'+n,title:'Produto '+n,marketplaceAccountId:'ml',marketplaceAccount:{businessKey:'x'},availableQuantity:1,soldQuantity:n===1?1000:2,price:100,rawData:{},variants:[],links:[],status:'active'}));
    jest.spyOn(service,'findAll').mockResolvedValue({data:rows,pagination:{total:2,page:1,limit:50,pages:1}} as any);
    const query=Object.assign(new ListingsQuery(),{marketplaceAccountId:'bling',sortBy:'sold',sortDirection:'desc',dateFrom:'2026-10-01',dateTo:'2026-10-02',limit:1});
    const page=await service.findGrouped(query);expect(page.data[0].itemId).toBe('MLB2');expect((page.data[0] as any).periodSoldQuantity).toBe(40);expect(page.pagination.total).toBe(2);
    expect(ranking).toHaveBeenCalledWith('bling',['MLB1','MLB2'],'2026-10-01','2026-10-02',undefined);
    query.page=2;expect((await service.findGrouped(query)).data[0].itemId).toBe('MLB1');
  });
  function setup(){
    const prisma:any={integrationSnapshot:{findMany:jest.fn().mockResolvedValue([])},marketplaceAccount:{findMany:jest.fn().mockResolvedValue([])},product:{findMany:jest.fn().mockResolvedValue([])},productVariant:{findMany:jest.fn().mockResolvedValue([])}};
    const listing=(id:string,stock:number,sold:number,price:number,family?:string)=>({id,itemId:id,title:id,marketplaceAccountId:'ml',marketplaceAccount:{businessKey:'mottum'},availableQuantity:stock,soldQuantity:sold,price:String(price),rawData:family?{family_id:family}:{},variants:[],links:[],status:'active'});
    const service=new ListingsService(prisma);jest.spyOn(service,'findAll').mockResolvedValue({data:[listing('MLB1',10,5,10,'family'),listing('MLB2',20,6,100,'family'),listing('MLB3',40,9,20)],pagination:{page:1,limit:50,total:3,pages:1}} as any);
    return service;
  }
  it('sorts by total stock across the family and pages after sorting the whole result',async()=>{const service=setup();const first=await service.findGrouped(Object.assign(new ListingsQuery(),{sortBy:'stock',sortDirection:'desc',limit:1}));expect(first.data[0].itemId).toBe('MLB3');const second=await service.findGrouped(Object.assign(new ListingsQuery(),{sortBy:'stock',sortDirection:'desc',limit:1,page:2}));expect(second.data[0].availableQuantity).toBe(30);expect(second.pagination.total).toBe(2);});
  it('sorts sold quantities using the aggregate instead of the first member',async()=>{const result=await setup().findGrouped(Object.assign(new ListingsQuery(),{sortBy:'sold',sortDirection:'desc'}));expect(result.data.map(row=>row.soldQuantity)).toEqual([11,9]);});
  it('sorts numerically by the displayed starting price for families with a range',async()=>{const result=await setup().findGrouped(Object.assign(new ListingsQuery(),{sortBy:'price',sortDirection:'desc'}));expect(result.data.map(row=>row.price)).toEqual([20,10]);expect(result.data[1].maxPrice).toBe(100);});
  it('supports ascending order and preserves other filters',async()=>{const result=await setup().findGrouped(Object.assign(new ListingsQuery(),{sortBy:'stock',sortDirection:'asc',status:'active'}));expect(result.data.map(row=>row.availableQuantity)).toEqual([30,40]);});
});
