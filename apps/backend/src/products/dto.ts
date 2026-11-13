import { IsBooleanString, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQuery } from '../common/pagination';

export class ProductQueryDto extends PaginationQuery {
  @IsOptional() @IsIn(['listings']) sortBy?: 'listings';
  @IsOptional() @IsIn(['asc','desc']) sortDirection?: 'asc'|'desc';
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() listingStatus?: string;
  @IsOptional() @IsString() integrationStatus?: string;
  @IsOptional() @IsString() marketplaceAccountId?: string;
  @IsOptional() @IsBooleanString() hasListing?: string;
  @IsOptional() @IsBooleanString() hasIssues?: string;
  @IsOptional() @IsString() auditType?: string;
  @IsOptional() @IsString() severity?: string;
}
