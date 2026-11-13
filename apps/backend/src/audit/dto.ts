import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AdsAuditQuery {
  @IsOptional() @IsString() marketplaceAccountId?: string;
  @IsOptional() @IsString() skuBase?: string;
  @IsOptional() @IsString() marketplace?: string;
  @IsOptional() @IsString() conta?: string;
  @IsOptional() @IsIn(['SEM_ANUNCIO', 'OK', 'POSSIVEL_DUPLICIDADE']) status?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() somenteSemAnuncio?: boolean;
  @IsOptional() @Type(() => Boolean) @IsBoolean() somenteDuplicidades?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 50;
}
