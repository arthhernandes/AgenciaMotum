import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQuery } from '../common/pagination';
export class ListingPricesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({each:true}) @Matches(/^MLB\d+$/,{each:true}) ids!:string[];
}
export class ListingSalesDto extends ListingPricesDto {
 @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom!:string;
 @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo!:string;
}

export class ListingVisitsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({each:true}) @Matches(/^MLB\d+$/,{each:true}) ids!:string[];
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom?:string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo?:string;
}

export class ListingsQuery extends PaginationQuery {
  @IsOptional() @IsString() @MaxLength(100) progressId?:string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom?:string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo?:string;
  @IsOptional() @IsIn(['with','without','unknown']) promotion?:'with'|'without'|'unknown';
  @IsOptional() @IsIn(['true','false']) full?:'true'|'false';
  @IsOptional() @IsIn(['incomplete','complete','cost_above_bling']) fiscalStatus?:'incomplete'|'complete'|'cost_above_bling';
  @IsOptional() @IsIn(['stock','sold','price']) sortBy?:'stock'|'sold'|'price';
  @IsOptional() @IsIn(['asc','desc']) sortDirection?:'asc'|'desc';
  @IsOptional()
  @IsIn(['found', 'partial', 'missing', 'no_sku'])
  skuMatch?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  marketplaceAccountId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  linked?: string;
}
