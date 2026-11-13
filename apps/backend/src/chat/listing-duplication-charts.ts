import { BadRequestException } from '@nestjs/common';
import { MercadoLivreClient } from '../mercadolivre/mercadolivre.client';
import { chartSizeKey } from './chat-size-charts';
import { sameSize } from '../listing-links/sku-correspondence';
import { copyAttributesMatch } from './listing-duplication-model';

export const chartAttributeValue=(a:any)=>String(a?.value_name??a?.values?.[0]?.name??a?.value_id??'');
export async function duplicationChartPlans(client:MercadoLivreClient,token:string,sourceSeller:string,destinationSeller:string,rows:any[],name:string){
  if(sourceSeller===destinationSeller)return [];
  const ids=[...new Set<string>(rows.flatMap(row=>[...(row.body.attributes??[]),...(row.body.variations??[]).flatMap((v:any)=>v.attributes??[])]).filter(a=>a.id==='SIZE_GRID_ID').map(chartAttributeValue))].filter(Boolean);
  const plans:any[]=[];
  for(const id of ids){
    const chart=await client.getSizeChart(token,id);
    if(['STANDARD','BRAND'].includes(chart.type))continue;
    if(String(chart.seller_id)!==sourceSeller)throw new BadRequestException('A tabela de medidas do modelo não pertence ao vendedor de origem.');
    const clean=(attributes:any[])=>attributes.filter(a=>a.id&&a.values?.length).map(a=>({id:a.id,values:a.values.map((v:any)=>({...((v.id!=null&&String(v.id).trim())?{id:String(v.id)}:{}),...(v.name!=null?{name:v.name}:{}),...(v.struct?{struct:v.struct}:{})}))})).sort((a,b)=>a.id.localeCompare(b.id));
    if(!chart.domain_id||!chart.measure_type||!chart.rows?.length||chart.rows.some((row:any)=>!row.attributes?.some((a:any)=>a.id==='SIZE'&&a.values?.[0]?.name)))throw new BadRequestException('Não foi possível conferir a tabela de medidas para copiar à conta de destino.');
    plans.push({sourceId:id,name,body:{domain_id:String(chart.domain_id).replace(/^MLB-/,''),site_id:'MLB',type:'SPECIFIC',measure_type:chart.measure_type,attributes:clean(chart.attributes??[]),main_attribute:{attributes:[{site_id:'MLB',id:'SIZE'}]},rows:[...chart.rows].sort((a:any,b:any)=>String(a.id).localeCompare(String(b.id))).map((row:any)=>({attributes:clean(row.attributes)}))},oldRows:chart.rows.map((row:any)=>({id:String(row.id),size:row.attributes.find((a:any)=>a.id==='SIZE').values[0].name})).sort((a:any,b:any)=>a.id.localeCompare(b.id)),state:'PENDING',id:null,rowIds:{}});
  }
  return plans;
}
export function verifyCopiedDuplicationChart(plan:any,chart:any,sellerId:string){
  if(String(chart.seller_id)!==sellerId||chart.site_id!=='MLB'||String(chart.domain_id).replace(/^MLB-/,'')!==plan.body.domain_id||chart.measure_type!==plan.body.measure_type)throw new Error('A conta ou a categoria da nova tabela não foi confirmada.');
  if(!copyAttributesMatch(chart.attributes??[],plan.body.attributes))throw new Error('A marca ou o gênero da nova tabela não foi confirmado.');
  const rowIds:Record<string,string>={};
  for(const old of plan.oldRows){
    const candidates=(chart.rows??[]).filter((row:any)=>row.attributes?.some((a:any)=>a.id==='SIZE'&&a.values?.some((v:any)=>chartSizeKey(v.name)===chartSizeKey(old.size)||sameSize(v.name,old.size))));
    if(candidates.length!==1||candidates[0].id==null)throw new Error('A nova tabela não confirmou os tamanhos do modelo.');
    const expected=plan.body.rows.find((row:any)=>row.attributes.some((a:any)=>a.id==='SIZE'&&a.values?.some((v:any)=>v.name===old.size)));
    for(const attribute of expected.attributes){
      const actual=candidates[0].attributes.find((a:any)=>a.id===attribute.id);
      if(!actual||!attribute.values.every((wanted:any)=>(actual.values??[]).some((observed:any)=>wanted.struct?observed.struct?.number===wanted.struct.number&&observed.struct?.unit===wanted.struct.unit:wanted.id!=null?String(observed.id)===String(wanted.id):chartSizeKey(observed.name)===chartSizeKey(wanted.name))))throw new Error('As medidas ou equivalências da nova tabela diferem do modelo.');
    }
    rowIds[old.id]=String(candidates[0].id);
  }
  return rowIds;
}
export function applyCopiedDuplicationCharts(body:any,plans:any[]){
  const apply=(attributes:any[],parentId?:string)=>{
    const id=chartAttributeValue(attributes.find(a=>a.id==='SIZE_GRID_ID'))||parentId;
    const plan=plans.find(p=>p.sourceId===id);if(!plan)return;
    if(!plan.id||plan.state!=='SUCCESS')throw new Error('A nova tabela de medidas ainda não foi confirmada.');
    for(const attribute of attributes){if(attribute.id==='SIZE_GRID_ID'){attribute.value_name=plan.id;delete attribute.value_id;delete attribute.values;}if(attribute.id==='SIZE_GRID_ROW_ID'){const row=plan.rowIds[chartAttributeValue(attribute)];if(!row)throw new Error('O tamanho da oferta não consta na tabela copiada.');attribute.value_name=row;delete attribute.value_id;delete attribute.values;}}
  };
  const old=chartAttributeValue((body.attributes??[]).find((a:any)=>a.id==='SIZE_GRID_ID'));
  apply(body.attributes??[]);
  for(const variation of body.variations??[])apply(variation.attributes??[],old);
}
