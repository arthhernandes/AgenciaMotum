import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';
import { effectivePermissions } from './permissions';

const COST_KEY=/^(cost|costs|custo|custos|preco_?custo|cost_?price|purchase_?price|acquisition_?cost)$/i;
export const mentionsCosts=(value:string)=>/\b(?:custos?|costs?|pre[cç]o\s+(?:de\s+)?(?:compra|aquisi[cç][aã]o))\b/i.test(value);
function containsCostData(value:any):boolean {
  if(typeof value==='string')return mentionsCosts(value)&&/\d/.test(value);
  if(Array.isArray(value))return value.some(containsCostData);
  return !!value&&typeof value==='object'&&Object.entries(value).some(([key,entry])=>COST_KEY.test(key)||containsCostData(entry));
}
/** Remove structured values and historical free text before returning it or using it as AI context. */
export function redactCosts<T>(input:T):T {
  const visit=(value:any):any=>{
    if(typeof value==='string')return mentionsCosts(value)&&/\d/.test(value)?'Informação de custo restrita.':value;
    if(Array.isArray(value))return value.map(visit).filter(entry=>entry!==undefined);
    if(!value||typeof value!=='object'||value instanceof Date)return value;
    if([value.field,value.id].some(label=>typeof label==='string'&&(COST_KEY.test(label)||mentionsCosts(label))))return undefined;
    const sensitiveMessage=typeof value.content==='string'&&containsCostData([value.toolContext,value.actions,value.variantPreview]);
    return Object.fromEntries(Object.entries(value).filter(([key])=>!COST_KEY.test(key)).map(([key,entry])=>[key,key==='content'&&sensitiveMessage?'Informação de custo restrita.':visit(entry)]).filter(([,entry])=>entry!==undefined));
  };
  return visit(input);
}
@Injectable()
export class CostVisibilityInterceptor implements NestInterceptor {
  intercept(context:ExecutionContext,next:CallHandler){
    const request=context.switchToHttp().getRequest();
    if(!request.user||effectivePermissions(request.user).includes('costs.view'))return next.handle();
    return next.handle().pipe(map(value=>redactCosts(value)));
  }
}
