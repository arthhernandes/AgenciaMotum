import { ProductAds } from './product-ads';
import { FinanceApi, FinanceHttpError } from './finance-api';
import { allocate, cents, money, profitability } from './profitability-calculation';
import { sellerSku } from '../mercadolivre/synchronization/seller-sku';
export function validateTaxRate(rate:number){
  if(typeof rate!=='number'||!Number.isFinite(rate)||rate<0||rate>100)throw Error('Informe o imposto geral entre 0 e 100%.');
}

type Period={dateFrom:string;dateTo:string};
const cleanId=(value:any)=>/^\d+$/.test(String(value??''))?String(value):null;
export function validateProfitPeriod(period:Period){
  const valid=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  if(!valid(period.dateFrom)||!valid(period.dateTo)||period.dateFrom>period.dateTo)throw Error('Informe datas válidas e em ordem.');
  if((Date.parse(period.dateTo)-Date.parse(period.dateFrom))/86400000>365)throw Error('Consulte intervalos de até 12 meses.');
}
export class ProfitabilityEngine {
  private adsClient?:ProductAds;
  private productAds(){return this.adsClient??=new ProductAds(this.api,this.sellerId);}
  private cache=new Map<string,{expires:number;data:Promise<any>}>();
  constructor(private api:FinanceApi,readonly sellerId:string){if(!cleanId(sellerId))throw Error('SELLER_ID inválido');}
  private cached<T>(key:string,call:()=>Promise<T>):Promise<T>{
    const old=this.cache.get(key);if(old&&old.expires>Date.now())return old.data;
    const data=call().catch(error=>{this.cache.delete(key);throw error;});this.cache.set(key,{expires:Date.now()+15*60_000,data});
    if(this.cache.size>3000)this.cache.delete(this.cache.keys().next().value!);return data;
  }
  private order(id:string):Promise<any>{return this.cached('order:'+id,async()=>{
    const o=await this.api.get('/orders/'+id);if(String(o.seller?.id)!==this.sellerId)throw Error('Pedido não pertence ao vendedor selecionado');
    return {id:String(o.id),date_created:o.date_created,status:o.status,currency_id:o.currency_id,pack_id:cleanId(o.pack_id),shipping:o.shipping,order_items:o.order_items,payments:o.payments?.map((p:any)=>({status:p.status,refunded:p.transaction_amount_refunded}))};
  });}
  private async sku(line:any){
    if(typeof line.item?.seller_sku==='string'&&line.item.seller_sku.trim())return line.item.seller_sku.trim();
    if(!/^MLB\d+$/.test(line.item?.id??''))return null;
    const item=await this.cached('item:'+line.item.id,()=>this.api.get('/items/'+line.item.id,{include_attributes:'all'}));
    if(String(item.seller_id)!==this.sellerId)throw Error('Anúncio de outro vendedor');
    const variant=line.item.variation_id?item.variations?.find((v:any)=>String(v.id)===String(line.item.variation_id)):null;
    if(line.item.variation_id&&!variant)return null;
    const source=variant??item,value=sellerSku(source)||source.seller_sku||line.item?.seller_custom_field;
    return typeof value==='string'&&value.trim()?value.trim():null;
  }
  private fiscal(sku:string){return this.cached('fiscal:'+sku,async()=>{
    const value=await this.api.get('/items/fiscal_information/'+encodeURIComponent(sku));
    if(String(value.seller_id)!==this.sellerId||value.sku!==sku)throw Error('Cadastro fiscal não corresponde ao vendedor/SKU');
    return {cost:cents(value.cost),checkedAt:new Date().toISOString()};
  });}
  private async shipment(order:any):Promise<string|null>{
    const id=cleanId(order.shipping?.id);if(id)return id;
    if(!order.pack_id)return null;
    const pack=await this.cached('pack:'+order.pack_id,()=>this.api.get('/packs/'+order.pack_id));
    return cleanId(pack.shipment?.id);
  }
  private async shippingFor(order:any,index:number){
    const shipmentId=await this.shipment(order);
    if(!shipmentId){const cost=order.shipping?.id===null||order.shipping===null?0:null;return {seller:cost,buyer:cost};}
    const distribution=await this.cached('shipping:'+shipmentId,async()=>{
      const costs=await this.api.get('/shipments/'+shipmentId+'/costs');
      const sender=costs.senders?.find((s:any)=>String(s.user_id)===this.sellerId),cost=cents(sender?.cost);
      if(cost===null)throw Error('Custo de frete do vendedor indisponível');
      // Resolve every order in this shipment, including orders outside the report dates.
      const shipmentItems=await this.api.get('/shipments/'+shipmentId+'/items');
      const entries=Array.isArray(shipmentItems)?shipmentItems:shipmentItems.items;
      if(!Array.isArray(entries)||!entries.length)throw Error('Não foi possível conferir os pedidos do envio');
      const orderIds=[...new Set<string>(entries.filter((e:any)=>String(e.sender_id??e.seller_id??this.sellerId)===this.sellerId).map((e:any)=>cleanId(e.order_id)).filter((id:string|null):id is string=>id!==null))];
      if(!orderIds.includes(order.id))throw Error('Pedido ausente nos itens do envio');
      const lines:Array<{key:string;revenue:number}>=[];
      for(const id of orderIds.sort()){
        const related=await this.order(id);if(related.status==='cancelled')continue;
        if(related.currency_id!=='BRL')throw Error('Moedas diferentes no mesmo envio');
        for(const [i,line]of related.order_items.entries()){
          const unit=cents(line.unit_price),q=line.quantity;if(unit===null||!Number.isSafeInteger(q)||q<=0)throw Error('Valor inválido para rateio do frete');
          lines.push({key:id+':'+i,revenue:unit*q});
        }
      }
      const weights=lines.map(r=>r.revenue),parts=allocate(cost,weights);
      // Receiver costs describe the whole shipment. Do not attribute another seller's share.
      const buyerCost=costs.senders?.every((s:any)=>String(s.user_id)===this.sellerId)?cents(costs.receiver?.cost):null;
      const buyerParts=buyerCost===null?null:allocate(buyerCost,weights);
      return new Map(lines.map((r,i)=>[r.key,{seller:parts[i],buyer:buyerParts?.[i]??null}]));
    });
    return distribution.get(order.id+':'+index)??{seller:null,buyer:null};
  }
  private async analyze(order:any,taxRate:number|null){
    const rows:any[]=[];
    for(const [index,line]of order.order_items.entries()){
      const issues:string[]=[],q=Number.isSafeInteger(line.quantity)&&line.quantity>0?line.quantity:null,unit=cents(line.unit_price),fee=cents(line.sale_fee);
      const revenue=q!==null&&unit!==null?unit*q:null,commission=q!==null&&fee!==null?fee*q:null;
      if(revenue===null)issues.push('Preço ou quantidade inválidos');if(commission===null)issues.push('Taxa ML indisponível');
      let sku:string|null=null,acquisition:number|null=null,shipping:number|null=null,buyerShipping:number|null=null,taxes:number|null=null,costCheckedAt:string|null=null;
      try{sku=await this.sku(line);if(!sku)throw Error('SKU não identificado');const fiscal=await this.fiscal(sku);acquisition=q!==null&&fiscal.cost!==null?fiscal.cost*q:null;costCheckedAt=fiscal.checkedAt;if(acquisition===null)issues.push('Custo fiscal não cadastrado');}catch{issues.push('Não foi possível consultar o custo fiscal por SKU');}
      try{const freight=await this.shippingFor(order,index);shipping=freight.seller;buyerShipping=freight.buyer;if(shipping===null)issues.push('Frete do vendedor não confirmado');}catch{issues.push('Não foi possível consultar ou ratear o frete');}
      taxes=revenue===null||taxRate===null?null:Math.round((revenue*taxRate/100)+Number.EPSILON);
      const refunded=order.payments?.some((p:any)=>Number(p.refunded)>0||['refunded','charged_back'].includes(p.status));
      if(refunded)issues.push('Pedido com estorno/reembolso: requer conciliação');
      if(order.currency_id!=='BRL')issues.push('Moeda diferente de BRL');
      const eligible=order.status==='paid'&&!refunded&&order.currency_id==='BRL';
      rows.push({orderId:order.id,itemIndex:index,itemId:line.item?.id,variationId:line.item?.variation_id??null,title:line.item?.title??'',sku,quantity:q,createdAt:order.date_created,status:order.status,currency:order.currency_id,unitPrice:money(unit),revenue:money(revenue),commission:money(commission),sellerShipping:money(shipping),buyerShipping:money(buyerShipping),fiscalCost:money(acquisition),invoiceTaxes:money(taxes),taxRate,taxSource:'Percentual geral informado pelo usuário',costCheckedAt,costSource:'Cadastro fiscal Mercado Livre (valor atual)',...profitability(revenue,commission,shipping,acquisition,taxes,eligible),issues});
    }return rows;
  }
  async fillMissingCosts(row:any){
    const updated={...row};
    if(updated.fiscalCost==null){
      try{
        const sku=updated.sku||await this.sku({item:{id:row.itemId,variation_id:row.variationId}});
        if(sku){updated.sku=sku;const fiscal=await this.fiscal(sku);if(fiscal.cost!==null&&Number.isSafeInteger(row.quantity)&&row.quantity>0){updated.fiscalCost=money(fiscal.cost*row.quantity);updated.costCheckedAt=fiscal.checkedAt;}}
        else{
          try{
            const detail=await this.api.get('/items/'+row.itemId+'/fiscal_information/detail');
            if(String(detail.seller_id)!==this.sellerId||detail.item_id!==row.itemId)throw Error('Cadastro fiscal de outro anúncio');
            const record=row.variationId?detail.variations?.find((variation:any)=>String(variation.id)===String(row.variationId))?.sku:detail.sku;
            if(record&&String(record.seller_id)===this.sellerId&&typeof record.sku==='string'){
              updated.sku=record.sku;const cost=cents(record.cost);if(cost!==null&&Number.isSafeInteger(row.quantity)&&row.quantity>0){updated.fiscalCost=money(cost*row.quantity);updated.costCheckedAt=new Date().toISOString();}
            }
          }catch(error){if(error instanceof FinanceHttpError&&error.status===404)updated.fiscalCostMessage='Anúncio sem SKU e sem cadastro fiscal vinculado no Mercado Livre.';}
        }
      }catch{/* Keep unconfirmed costs pending. */}
    }
    if(updated.sellerShipping==null){try{const order=await this.order(String(row.orderId)),line=order.order_items?.[row.itemIndex];if(line?.item?.id===row.itemId&&line.quantity===row.quantity){const shipping=await this.shippingFor(order,row.itemIndex);updated.sellerShipping=money(shipping.seller);updated.buyerShipping=money(shipping.buyer);}}catch{/* Keep unconfirmed shipping pending. */}}
    updated.issues=(row.issues??[]).filter((issue:string)=>!(updated.fiscalCost!==null&&/Custo fiscal|custo fiscal por SKU/.test(issue))&&!(updated.sellerShipping!==null&&/Frete do vendedor|consultar ou ratear o frete/.test(issue)));
    if(updated.fiscalCost!==null)delete updated.fiscalCostMessage;
    if(updated.fiscalCostMessage)updated.issues=[...updated.issues.filter((issue:string)=>!/Custo fiscal|custo fiscal por SKU|Anúncio sem SKU/.test(issue)),updated.fiscalCostMessage];
    return {...updated,...profitability(cents(updated.revenue),cents(updated.commission),cents(updated.sellerShipping),cents(updated.fiscalCost),cents(updated.invoiceTaxes),updated.status==='paid'&&updated.currency==='BRL'&&!updated.issues.some((issue:string)=>/estorno|reembolso/i.test(issue)))};
  }
  async refreshFiscal(row:any){
    let sku=await this.sku({item:{id:row.itemId,variation_id:row.variationId}}),cost:number|null=null,checkedAt=new Date().toISOString();
    try{
      if(sku){const fiscal=await this.fiscal(sku);cost=fiscal.cost;checkedAt=fiscal.checkedAt;}
      else{
        const detail=await this.api.get('/items/'+row.itemId+'/fiscal_information/detail');
        if(String(detail.seller_id)!==this.sellerId||detail.item_id!==row.itemId)throw Error('Cadastro fiscal de outro anúncio.');
        const record=row.variationId?detail.variations?.find((variation:any)=>String(variation.id)===String(row.variationId))?.sku:detail.sku;
        if(record&&String(record.seller_id)===this.sellerId&&typeof record.sku==='string'){sku=record.sku;cost=cents(record.cost);}
      }
    }catch(error){if(!(error instanceof FinanceHttpError&&error.status===404))throw error;}
    const fiscalCost=cost!==null&&Number.isSafeInteger(row.quantity)&&row.quantity>0?money(cost*row.quantity):null;
    const issues=(row.issues??[]).filter((issue:string)=>!/custo fiscal|cadastro fiscal|Anúncio sem SKU/i.test(issue));
    if(fiscalCost===null)issues.push(sku?'Custo fiscal não confirmado para o SKU atual.':'Anúncio sem SKU e sem cadastro fiscal vinculado no Mercado Livre.');
    return {...row,sku,fiscalCost,costCheckedAt:checkedAt,fiscalCostMessage:fiscalCost===null?issues.at(-1):null,issues,...profitability(cents(row.revenue),cents(row.commission),cents(row.sellerShipping),cents(fiscalCost),cents(row.invoiceTaxes),row.status==='paid'&&row.currency==='BRL'&&!issues.some((issue:string)=>/estorno|reembolso/i.test(issue)))};
  }
  advertising(period:Period,itemIds:string[]){return new ProductAds(this.api,this.sellerId).costs(period,itemIds);}
  advertisingTotal(period:Period){return new ProductAds(this.api,this.sellerId).total(period);}
  advertisingInventory(period:Period){return this.productAds().inventory(period);}
  advertisingDaily(period:Period,itemId:string){return new ProductAds(this.api,this.sellerId).daily(period,itemId);}
  advertisingActivePeriod(itemId:string){return new ProductAds(this.api,this.sellerId).activePeriod(itemId);}
  advertisingCampaignPeriods(period:Period){return this.productAds().campaignPeriods(period);}
  async page(period:Period,taxRate:number|null=null,offset=0,limit=50){
    validateProfitPeriod(period);if(taxRate!==null)validateTaxRate(taxRate);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Paginação inválida');
    const search=await this.api.get('/orders/search',{seller:this.sellerId,'order.status':'paid','order.date_created.from':period.dateFrom+'T00:00:00.000-03:00','order.date_created.to':period.dateTo+'T23:59:59.999-03:00',sort:'date_asc',offset,limit});
    if(!Array.isArray(search.results)||!Number.isSafeInteger(search.paging?.total))throw Error('Resposta de paginação inválida');
    const rows:any[]=[],errors:any[]=[],seen=new Set<string>();
    for(const entry of search.results){
      const id=cleanId(typeof entry==='object'?entry.id:entry);if(!id){errors.push({orderId:null,message:'A busca retornou um identificador de pedido inválido'});continue;}if(seen.has(id))continue;seen.add(id);
      try{const order=await this.order(id);if(order.status!=='paid'){errors.push({orderId:id,message:'Pedido deixou de estar pago'});continue;}rows.push(...await this.analyze(order,taxRate));}
      catch(error){errors.push({orderId:id,message:error instanceof FinanceHttpError?error.message:'Falha ao consultar os dados deste pedido'});}
    }
    const next=offset+search.results.length,total=search.paging.total;
    return {sellerId:this.sellerId,dateFrom:period.dateFrom,dateTo:period.dateTo,taxRate,offset,limit,total,processedOrders:search.results.length,nextOffset:next<total&&search.results.length?next:null,incomplete:search.results.length===0&&offset<total,rows,errors,checkedAt:new Date().toISOString()};
  }
}
