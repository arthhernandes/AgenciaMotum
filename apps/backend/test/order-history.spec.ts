import { historyOrder } from '../src/reports/order-history';

describe('Order history archive',()=>{
  const order:any={id:1,seller:{id:7},buyer:{email:'private'},status:'paid',currency_id:'BRL',date_created:'2026-10-01T01:30:00Z',shipping:{id:8},payments:[{status:'approved'}],order_items:[{item:{id:'MLB1',seller_sku:'A',title:'Produto'},quantity:2,unit_price:100,sale_fee:10}]};
  it('keeps seller isolation, BRT dates, unit fees, fiscal costs and no buyer data',()=>{
    const data=historyOrder(order,'7',new Map([['A',{cost:5000,checkedAt:'now'}]]),new Map(),'now');
    expect(data.orderDate).toBe('2026-09-30');expect(data.rows[0]).toMatchObject({revenue:200,commission:20,fiscalCost:100,sellerShipping:null,netProfit:null});expect(JSON.stringify(data)).not.toContain('private');expect(()=>historyOrder(order,'8',new Map(),new Map(),'now')).toThrow();
  });
  it('archives cancelled orders without reporting profit and reuses confirmed shipping only for the same line',()=>{
    const prior=new Map([['1:0',{itemId:'MLB1',quantity:2,unitPrice:100,sellerShipping:10,fiscalCost:100}]]);
    expect(historyOrder({...order,status:'cancelled'},'7',new Map(),prior,'now').rows[0]).toMatchObject({status:'cancelled',sellerShipping:10,netProfit:null,profitBeforeTaxes:null});
    expect(historyOrder({...order,order_items:[{...order.order_items[0],quantity:1}]},'7',new Map(),prior,'now').rows[0].sellerShipping).toBeNull();
  });
});
