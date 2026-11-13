import { standardPrices, proposedPrices, withoutPrice } from '../src/chat/chat-standard-prices';
describe('Standard price channel payloads',()=>{
  const row=(channel:string,amount:number)=>({type:'standard',amount,currency_id:'BRL',conditions:{context_restrictions:[channel]}});
  it('includes all existing channels and preserves the separate shop price',()=>{
    const before=standardPrices({prices:[row('channel_marketplace',319.99),row('channel_mshops',350)]},'BRL');
    const prices=proposedPrices(before,299.9);
    expect(prices.find(price=>price.conditions.context_restrictions.includes('channel_marketplace'))?.amount).toBe(299.9);
    expect(prices.find(price=>price.conditions.context_restrictions.includes('channel_mshops'))?.amount).toBe(350);
    expect(prices).toHaveLength(2);expect(before[0].amount).toBe(319.99);
  });
  it('preserves a shared standard context and excludes quantity prices',()=>{
    const prices=standardPrices({prices:[{...row('channel_marketplace',100),conditions:{context_restrictions:[]}},{...row('channel_marketplace',90),conditions:{context_restrictions:['channel_marketplace'],min_purchase_unit:3}},{...row('channel_marketplace',70),type:'promotion'}]},'BRL');
    expect(proposedPrices(prices,120)).toEqual([{amount:120,currency_id:'BRL',conditions:{context_restrictions:[]}}]);
  });
  it('never invents channels or currencies when the read is missing or invalid',()=>{
    expect(()=>standardPrices({prices:[]},'BRL')).toThrow();
    expect(()=>standardPrices({prices:[{...row('channel_marketplace',100),currency_id:'USD'}]},'BRL')).toThrow();
    expect(()=>standardPrices({prices:[{...row('channel_marketplace',100),conditions:{}}]},'BRL')).toThrow();
    expect(()=>proposedPrices(standardPrices({prices:[row('channel_mshops',100)]},'BRL'),120)).toThrow();
  });
  it('removes prices from PUT while retaining requested stock and all variation IDs',()=>{
    expect(withoutPrice({price:120,variations:[{id:1,price:120},{id:2,price:120,available_quantity:4}]})).toEqual({variations:[{id:1},{id:2,available_quantity:4}]});
    expect(withoutPrice({price:120,variations:[{id:1,price:120}]})).toEqual({});
  });
});
