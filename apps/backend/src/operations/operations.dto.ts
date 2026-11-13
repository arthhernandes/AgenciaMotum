import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQuery } from '../common/pagination';

export const FISCAL_TEMPLATE_FIELDS=['ncm','cest','origin_type','origin_detail','measurement_unit','csosn','tax_rule_id','ex_tipi'] as const;
export class FiscalTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!:string;
  @IsIn(['simples','normal']) regime!:string;
  @IsObject() values!:Record<string,string>;
  @IsOptional() @IsString() @MaxLength(100) version?:string;
}
export class PendingQuery extends PaginationQuery {
  @IsOptional() @IsString() @MaxLength(100) search?:string;
  @IsOptional() @IsIn(['warning','info','all']) severity?:string;
  @IsOptional() @IsIn(['all','MISSING','SKU','STOCK','COLOR','SIZE','PAUSED','CHART','MULTIPLE','UNMATCHED','NO_SKU','UNLINKED']) type?:string;
}
