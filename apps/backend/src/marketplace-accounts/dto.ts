import { ApiProperty } from '@nestjs/swagger';
import { Marketplace } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateStoreDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}

export class CreateMarketplaceAccountDto {
  @ApiProperty({ enum: Marketplace, default: Marketplace.MERCADO_LIVRE })
  @IsEnum(Marketplace)
  marketplace: Marketplace = Marketplace.MERCADO_LIVRE;

  @IsString()
  name!: string;

  @IsString()
  sellerId!: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
