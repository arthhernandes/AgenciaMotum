import { IsOptional, IsString, Matches } from 'class-validator';
export class ReportQuery {
  @IsString() marketplaceAccountId!:string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom?:string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo?:string;
}
