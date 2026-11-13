import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginatedResponse } from '@olist-ml-audit/shared';

export class PaginationQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export function paginate<T>(data: T[], page: number, limit: number, total: number): PaginatedResponse<T> {
  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 }
  };
}
