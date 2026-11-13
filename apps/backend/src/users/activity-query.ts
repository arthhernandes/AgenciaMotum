import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQuery } from '../common/pagination';
export class ActivityQuery extends PaginationQuery {
 @IsOptional() @IsString() @MaxLength(200) userId?:string;
 @IsOptional() @IsString() @MaxLength(120) action?:string;
 @IsOptional() @IsDateString() from?:string;
 @IsOptional() @IsDateString() to?:string;
}
