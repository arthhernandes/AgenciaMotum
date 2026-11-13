import { IsOptional, IsString } from 'class-validator';

export class ManualLinkDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  productVariantId?: string;

  @IsString()
  listingId!: string;

  @IsOptional()
  @IsString()
  listingVariantId?: string;
}
