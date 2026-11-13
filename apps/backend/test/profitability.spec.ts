import { allocate, cents, profitability } from '../src/reports/profitability-calculation';
import { FinanceApi } from '../src/reports/finance-api';
import { ProfitabilityEngine, validateTaxRate } from '../src/reports/profitability-engine';
import { assertRoutePermissions } from '../src/auth/permissions';

const order=(id:string,quantity=2):any=>({id,seller:{id:7},status:'paid',currency_id:'BRL',date_created:'2026-10-01T12:00:00-03:00',shipping:{id:10},pack_id:100,payments:[{status:'approved',transaction_amount_refunded:0}],order_items:[{item:{id:'MLB1',title:'Camisa',seller_sku:'5484.1'},quantity,unit_price:100,sale_fee:10}]});
describe('Profitability amounts and general tax',()=>{
  it('uses integer cents, recognizes real zero and refuses missing/invalid values',()=>{expect(cents(0)).toBe(0);expect(cents(174.59)).toBe(17459);for(const value of [null,undefined,NaN,-1,'','50,00'])expect(cents(value)).toBeNull();});
  it('allocates a shipment once and preserves every cent',()=>{expect(allocate(1001,[20000,10000])).toEqual([667,334]);expect(allocate(1,[1,1,1]).reduce((a,b)=>a+b,0)).toBe(1);});
  it('calculates the requested formula and does not invent profit with missing taxes',()=>{
    expect(profitability(20000,2000,667,10000,1400)).toEqual({operatingCost:140.67,profitBeforeTaxes:73.33,netProfit:59.33,netMargin:29.67});
    expect(profitability(20000,2000,667,10000,null)).toMatchObject({operatingCost:null,profitBeforeTaxes:73.33,netProfit:null,netMargin:null});
    expect(profitability(0,0,0,0,0).netMargin).toBeNull();expect(profitability(100,200,0,0,0).netProfit).toBe(-1);
  });
  it('requires an explicit general rate and accepts zero',()=>{for(const rate of [undefined,null,'',NaN,Infinity,-1,101])expect(()=>validateTaxRate(rate as any)).toThrow();for(const rate of [0,6.5,100])expect(()=>validateTaxRate(rate)).not.toThrow();});
  it('requires cost permission for the financial report',()=>{
    expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['reports.view']},'GET','/api/reports/profitability')).toThrow();
    expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['reports.view','costs.view']},'GET','/api/reports/profitability')).not.toThrow();
  });
});
describe('Profitability API reads',()=>{
  it('retries rate limits and server failures, never sends writes',async()=>{
    const http:any=jest.fn().mockResolvedValueOnce(new Response('{}',{status:429,headers:{'retry-after':'1'}})).mockResolvedValueOnce(new Response('{}',{status:503})).mockResolvedValueOnce(new Response('{"ok":true}',{status:200}));
    const token=jest.fn().mockResolvedValue('secret'),pause=jest.fn().mockResolvedValue(undefined),api=new FinanceApi(token,http,pause);
    expect(await api.get('/orders/1')).toEqual({ok:true});expect(http).toHaveBeenCalledTimes(3);expect(http.mock.calls.every((call:any)=>call[1].method==='GET')).toBe(true);expect(pause).toHaveBeenCalledTimes(2);
    await expect(api.get('//untrusted.example')).rejects.toThrow();expect(http).toHaveBeenCalledTimes(3);
  });
  it('refreshes credentials once on 401 and does not retry permission errors',async()=>{
    const http:any=jest.fn().mockResolvedValueOnce(new Response('{}',{status:401})).mockResolvedValueOnce(new Response('{}',{status:403})),token=jest.fn().mockResolvedValue('secret');
    await expect(new FinanceApi(token,http).get('/orders/1')).rejects.toThrow('403');expect(token).toHaveBeenCalledWith(true);expect(http).toHaveBeenCalledTimes(2);
  });
});
describe('Profitability per order',()=>{
  it('supports more than 50 results and processes the remaining page',async()=>{
    const get=jest.fn().mockImplementation(async(path:string,params:any)=>{
      if(path==='/orders/search')return {results:Array.from({length:params.offset===0?50:1},(_,i)=>({id:String(params.offset+i+1)})),paging:{total:51}};
      if(path.startsWith('/orders/'))return {...order(path.split('/').pop()!,1),shipping:null,pack_id:null};
      if(path.startsWith('/items/fiscal_information/'))return {sku:'5484.1',seller_id:7,cost:0};
      throw Error('Invoice unavailable');
    });
    const engine=new ProfitabilityEngine({get} as any,'7'),period={dateFrom:'2026-10-01',dateTo:'2026-10-02'};
    const first=await engine.page(period,7,0,50),last=await engine.page(period,7,50,50);
    expect(first.rows).toHaveLength(50);expect(first.nextOffset).toBe(50);expect(last.rows).toHaveLength(1);expect(last.nextOffset).toBeNull();expect(last.total).toBe(51);
  });
  function setup(){
    const get=jest.fn().mockImplementation(async(path:string,params?:any)=>{
      if(path==='/orders/search')return {results:[{id:params.offset===0?'1':'2'}],paging:{total:2}};
      if(path==='/orders/1')return order('1',2);if(path==='/orders/2')return order('2',1);
      if(path==='/items/fiscal_information/5484.1')return {seller_id:7,sku:'5484.1',cost:50};
      if(path==='/shipments/10/costs')return {receiver:{cost:999},senders:[{user_id:99,cost:500},{user_id:7,cost:10.01}]};
      if(path==='/shipments/10/items')return [{order_id:1,sender_id:7},{order_id:2,sender_id:7}];
      throw Error('Unexpected resource '+path);
    });return {get,engine:new ProfitabilityEngine({get} as any,'7')};
  }
  it('multiplies fees and fiscal costs by quantity and apportions shared shipping across pages',async()=>{
    const {get,engine}=setup(),period={dateFrom:'2026-10-01',dateTo:'2026-10-22'};
    const first=await engine.page(period,7,0,1),second=await engine.page(period,7,1,1);
    expect(first.nextOffset).toBe(1);expect(second.nextOffset).toBeNull();expect(first.rows[0]).toMatchObject({revenue:200,commission:20,fiscalCost:100,sellerShipping:6.67,invoiceTaxes:14,netProfit:59.33});
    expect(second.rows[0].sellerShipping).toBe(3.34);expect(first.rows[0].sellerShipping+second.rows[0].sellerShipping).toBeCloseTo(10.01);
    expect(get.mock.calls.filter(c=>c[0]==='/shipments/10/costs')).toHaveLength(1);expect(first.errors).toEqual([]);expect(get.mock.calls.some(c=>c[0].includes('/invoices/'))).toBe(false);
    const pending=await engine.page(period,null,0,1);expect(pending.rows[0]).toMatchObject({taxRate:null,invoiceTaxes:null,profitBeforeTaxes:73.33,netProfit:null,netMargin:null});
    const zero=await engine.page(period,0,0,1);expect(zero.rows[0]).toMatchObject({taxRate:0,invoiceTaxes:0,netProfit:73.33});
    const fraction=await engine.page(period,6.125,0,1);expect(fraction.rows[0].invoiceTaxes).toBe(12.25);
  });
  it('keeps missing cost unavailable and continues subsequent orders',async()=>{
    const {get,engine}=setup();get.mockImplementation(async(path:string)=>{if(path==='/orders/search')return {results:[{id:1},{id:2}],paging:{total:2}};if(path==='/orders/1')throw Error('Failure');if(path==='/orders/2')return {...order('2'),shipping:null,pack_id:null};throw Error('Unavailable');});
    const page=await engine.page({dateFrom:'2026-10-01',dateTo:'2026-10-02'},7);expect(page.errors).toHaveLength(1);expect(page.rows).toHaveLength(1);expect(page.rows[0]).toMatchObject({fiscalCost:null,invoiceTaxes:14,netProfit:null,netMargin:null});
  });
  it('allocates buyer freight once across the shipment without counting it as seller income',async()=>{
    const {get,engine}=setup(),original=get.getMockImplementation()!;
    get.mockImplementation(async(path:string,params:any)=>path==='/shipments/10/costs'?{receiver:{cost:10.01},senders:[{user_id:7,cost:10.01}]}:original(path,params));
    const period={dateFrom:'2026-10-01',dateTo:'2026-10-22'};
    const first=await engine.page(period,7,0,1),second=await engine.page(period,7,1,1);
    expect(first.rows[0]).toMatchObject({buyerShipping:6.67,sellerShipping:6.67,netProfit:59.33});
    expect(second.rows[0].buyerShipping).toBe(3.34);
    expect(first.rows[0].buyerShipping+second.rows[0].buyerShipping).toBeCloseTo(10.01);
  });
  it('does not allocate buyer freight for a shipment shared by different sellers',async()=>{
    const {engine}=setup();
    expect((await engine.page({dateFrom:'2026-10-01',dateTo:'2026-10-22'},7,0,1)).rows[0].buyerShipping).toBeNull();
  });
  it('blocks foreign sellers and suppresses net profit for refunded orders',async()=>{
    const {get,engine}=setup(),original=get.getMockImplementation()!;get.mockImplementation(async(path:string,params:any)=>path==='/orders/1'?{...order('1'),payments:[{status:'refunded',transaction_amount_refunded:200}]}:original(path,params));
    expect((await engine.page({dateFrom:'2026-10-01',dateTo:'2026-10-02'},7,0,1)).rows[0].netProfit).toBeNull();
    const other=setup();other.get.mockImplementation(async(path:string)=>path==='/orders/search'?{results:[{id:1}],paging:{total:1}}:{...order('1'),seller:{id:8}});expect((await other.engine.page({dateFrom:'2026-10-01',dateTo:'2026-10-02'},7)).rows).toEqual([]);
  });
});
