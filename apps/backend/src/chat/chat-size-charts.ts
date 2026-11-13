import { BadRequestException } from '@nestjs/common';
import { MercadoLivreClient, MeliItemResponse } from '../mercadolivre/mercadolivre.client';
import { sizeKey, sizeLabel } from '../listing-links/sku-correspondence';

export const chartSizeKey=sizeLabel;
type Source={token:string;account:{sellerId:string};item:MeliItemResponse};
export function chartRowSizes(chart:any):Array<{size:string;rowId:string}>{return (chart.rows??[]).flatMap((row:any)=>{const attribute=row.attributes?.find((a:any)=>a.id==='SIZE')??row.attributes?.find((a:any)=>a.id===chart.main_attribute_id);return (attribute?.values??[]).filter((value:any)=>value.name&&row.id!=null).map((value:any)=>({size:String(value.name),rowId:String(row.id)}));});}
export function checkedChartRows(chart:any,source:Source,sizes:string[]){
  const domain=String(source.item.domain_id??'').replace(/^MLB-/,'');
  if(chart.site_id&&chart.site_id!=='MLB'||chart.domain_id&&domain&&String(chart.domain_id).replace(/^MLB-/,'')!==domain)throw new BadRequestException('Essa tabela de medidas não corresponde à categoria deste anúncio.');
  if(!['STANDARD','BRAND'].includes(chart.type)&&String(chart.seller_id)!==source.account.sellerId)throw new BadRequestException('Essa tabela de medidas não pertence à conta do anúncio.');
  const mapped:Record<string,string>={};for(const row of chartRowSizes(chart)){const key=chartSizeKey(row.size);if(mapped[key]&&mapped[key]!==row.rowId)throw new BadRequestException(`A tabela possui mais de uma linha para ${row.size}. Escolha uma tabela sem ambiguidade de tamanhos.`);mapped[key]=row.rowId;}
  const original = Object.entries(mapped);
  const aliases = ['PP','XS','XS/PP','P','S','S/P','M','M/M','G','L','L/G','GG','XL','XL/GG','XXG','XGG','XXL','XXL/XXG','XXL/XGG',...sizes];
  for (const alias of aliases) {
    const key = chartSizeKey(alias), equivalent = sizeKey(key);
    if (mapped[key] || !equivalent) continue;
    const candidates = [...new Set(original.filter(([size]) => sizeKey(size) === equivalent).map(([,id]) => id))];
    if (candidates.length === 1) mapped[key] = candidates[0];
    else if (candidates.length > 1 && sizes.some(size => chartSizeKey(size) === key)) throw new BadRequestException(`A tabela possui mais de uma linha equivalente para ${alias}. Escolha uma tabela sem ambiguidade de tamanhos.`);
  }
  const missing=[...new Set(sizes.filter(size=>!mapped[chartSizeKey(size)]))];if(missing.length)throw new BadRequestException(`A tabela selecionada não atende os tamanhos: ${missing.join(', ')}. Escolha outra tabela antes de publicar.`);
  return mapped;
}
export class ChatSizeCharts {
  constructor(private readonly client:MercadoLivreClient,private readonly extraIds:string[]=[]){}
  async list(source:Source,sizes:string[]=[]){
    const domain=source.item.domain_id?.replace(/^MLB-/,'');if(!domain)throw new BadRequestException('Não foi possível identificar a categoria de medidas deste anúncio.');
    const attributes=(source.item.attributes??[]).filter(a=>a.id==='GENDER'||a.id==='BRAND').map(a=>({id:a.id,values:[{...(a.value_id?{id:a.value_id}:{}),name:a.value_name}]}));
    const found:any[]=[];let offset=0;
    for(let page=0;page<20;page++){
      const response=await this.client.searchSizeCharts(source.token,{domain_id:domain,site_id:'MLB',seller_id:Number(source.account.sellerId),attributes},offset);
      const charts=response.charts??[];found.push(...charts);offset+=charts.length;if(!charts.length||offset>=(response.paging?.total??offset))break;
      if(page===19)throw new BadRequestException('Há muitas tabelas disponíveis. Restrinja a categoria para consultar a lista completa.');
    }
    const current=source.item.attributes?.find(attribute=>attribute.id==='SIZE_GRID_ID')?.value_name;
    if(current&&!found.some(chart=>String(chart.id)===current))found.push(await this.client.getSizeChart(source.token,current));
    for(const id of this.extraIds){if(!found.some(chart=>String(chart.id)===id))found.push(await this.client.getSizeChart(source.token,id));}
    const results=[];for(const item of [...new Map(found.map(chart=>[String(chart.id),chart])).values()]){
      const chart=item.rows?.length&&(item.seller_id!=null||['BRAND','STANDARD'].includes(item.type))?item:await this.client.getSizeChart(source.token,String(item.id));
      let reason='';try{checkedChartRows(chart,source,sizes);}catch(error){reason=(error as Error).message;}
      if(!['STANDARD','BRAND'].includes(chart.type)&&String(chart.seller_id)!==source.account.sellerId)continue;
      results.push({id:String(chart.id),name:chart.names?.MLB??chart.name??`Tabela ${chart.id}`,type:chart.type,sizes:chartRowSizes(chart).map(row=>row.size),compatible:!reason,reason,
        rows:(chart.rows??[]).map((row:any)=>({size:chartRowSizes({...chart,rows:[row]}).map(size=>size.size).join(' / '),measurements:(row.attributes??[]).filter((attribute:any)=>attribute.id!=='SIZE').map((attribute:any)=>({name:attribute.name??attribute.id,value:(attribute.values??[]).map((value:any)=>value.name??value.struct?.number).filter((value:any)=>value!=null).join(' / ')}))}))});
    }
    return results;
  }
  async select(source:Source,id:string,sizes:string[]){
    if(!/^\d{1,30}$/.test(id))throw new BadRequestException('Selecione uma tabela de medidas válida.');
    const available=await this.list(source,sizes);const option=available.find(chart=>chart.id===id);if(!option)throw new BadRequestException('Essa tabela não está disponível para o vendedor e a categoria deste anúncio.');
    if(!option.compatible)throw new BadRequestException(option.reason);
    const chart=await this.client.getSizeChart(source.token,id);const rows=checkedChartRows(chart,source,sizes);return {id:String(chart.id),name:option.name,rows};
  }
}
export async function createdSizeCharts(prisma:{auditLog:any},accountId:string,modelMlb:string):Promise<string[]>{
  const rows=await prisma.auditLog.findMany({where:{action:'CHAT_SIZE_CHART_DRAFT',AND:[{before:{path:['accountId'],equals:accountId}},{before:{path:['modelMlb'],equals:modelMlb}},{after:{path:['status'],equals:'VERIFIED'}}]},orderBy:{createdAt:'desc'},take:50,select:{after:true}});
  return rows.map((row:any)=>row.after?.chartId).filter((id:any)=>typeof id==='string'&&/^\d+$/.test(id));
}

