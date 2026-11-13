import { BadRequestException } from '@nestjs/common';
import { MercadoLivreClient, MeliItemResponse } from '../mercadolivre/mercadolivre.client';

export async function sizeChartPolicy(client:MercadoLivreClient,token:string,item:MeliItemResponse){
  if(!item.category_id||!item.domain_id)throw new BadRequestException('Não foi possível identificar a categoria para verificar a tabela de medidas.');
  const [attributes,configuration]=await Promise.all([client.getCategoryAttributeDefinitions(token,item.category_id),client.getSizeChartDomains(token)]);
  if(!Array.isArray(attributes)||!Array.isArray(configuration?.domains))throw new BadRequestException('Não foi possível confirmar as regras de tabela de medidas no Mercado Livre. Tente novamente.');
  const grid=attributes.filter(attribute=>['SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(attribute.id));
  const tagged=(attribute:any,tag:string)=>Array.isArray(attribute.tags)?attribute.tags.includes(tag):attribute.tags?.[tag]===true;
  const required=grid.some(attribute=>tagged(attribute,'required')||tagged(attribute,'conditional_required'));
  const supported=required||configuration.domains.some(domain=>domain.domain_id.replace(/^MLB-/,'')===item.domain_id!.replace(/^MLB-/,''));
  return {categoryId:item.category_id,domainId:item.domain_id,supported,required,status:required?'REQUIRED':supported?'SUPPORTED':'NOT_APPLICABLE'};
}
