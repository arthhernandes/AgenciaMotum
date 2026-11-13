import { cents, money, profitability } from './profitability-calculation';

export type FiscalHistoryCost={cost:number|null;checkedAt:string};
/** Archive only financial/product fields. Search responses also contain buyer PII: never persist them. */
export function historyOrder(order:any,sellerId:string,fiscal:Map<string,FiscalHistoryCost>,previous:Map<string,any>,checkedAt:string){
  if(String(order.seller?.id)!==sellerId||!/^\d+$/.test(String(order.id)))throw Error('Pedido não corresponde ao vendedor.');
  const date=new Date(order.date_created);if(!Number.isFinite(date.getTime())||!Array.isArray(order.order_items))throw Error('Pedido sem data ou itens válidos.');
  const refunded=order.payments?.some((p:any)=>Number(p.transaction_amount_refunded)>0||['refunded','charged_back'].includes(p.status));
  const rows=order.order_items.map((line:any,index:number)=>{
    const q=Number.isSafeInteger(line.quantity)&&line.quantity>0?line.quantity:null,unit=cents(line.unit_price),fee=cents(line.sale_fee);
    const revenue=q!==null&&unit!==null?q*unit:null,commission=q!==null&&fee!==null?q*fee:null;
    const old=previous.get(String(order.id)+':'+index),same=old&&old.itemId===line.item?.id&&old.quantity===q&&old.unitPrice===money(unit);
    const rawSku=line.item?.seller_sku??(same?old.sku:null)??line.item?.seller_custom_field,sku=typeof rawSku==='string'&&rawSku.trim()?rawSku.trim():same?old.sku:null;
    const cost=sku?fiscal.get(sku):undefined;
    const acquisition=q!==null&&cost?.cost!==null&&cost?.cost!==undefined?cost.cost*q:same?cents(old.fiscalCost):null;
    const shipping=same?cents(old.sellerShipping):order.shipping===null&&!order.pack_id?0:null;
    const buyerShipping=same?cents(old.buyerShipping):order.shipping===null&&!order.pack_id?0:null;
    const issues:string[]=[];if(revenue===null)issues.push('Preço ou quantidade indisponíveis');if(commission===null)issues.push('Taxa ML indisponível');
    if(acquisition===null)issues.push('Custo fiscal ainda não confirmado');if(shipping===null)issues.push('Frete do vendedor ainda não confirmado');
    if(refunded||order.status==='partially_refunded')issues.push('Pedido com reembolso: requer conciliação');
    if(order.status!=='paid')issues.push('Pedido não está pago');if(order.currency_id!=='BRL')issues.push('Moeda diferente de BRL');
    return {orderId:String(order.id),itemIndex:index,itemId:line.item?.id??null,variationId:line.item?.variation_id??null,title:line.item?.title??'',sku,quantity:q,createdAt:order.date_created,status:order.status,currency:order.currency_id,unitPrice:money(unit),revenue:money(revenue),commission:money(commission),sellerShipping:money(shipping),buyerShipping:money(buyerShipping),fiscalCost:money(acquisition),invoiceTaxes:null,taxRate:null,costCheckedAt:cost?.checkedAt??(same?old.costCheckedAt:null),costSource:'Cadastro fiscal Mercado Livre (valor consultado)',...profitability(revenue,commission,shipping,acquisition,null,order.status==='paid'&&!refunded&&order.currency_id==='BRL'),issues};
  });
  return {orderId:String(order.id),sellerId,createdAt:order.date_created,orderDate:date.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),status:order.status,currency:order.currency_id,shipmentId:order.shipping?.id?String(order.shipping.id):null,packId:order.pack_id?String(order.pack_id):null,rows,checkedAt};
}
