import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
export class SkuLinkChoiceDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) parentSku?:string;
  @IsString() @MaxLength(40) mlb!: string;
  @IsString() @MaxLength(100) variationId!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) sku!: string;
}
export class SkuLinkSkipDto {
  @IsString() @MaxLength(40) mlb!:string;
  @IsString() @MaxLength(100) variationId!:string;
}
export class SkuLinkPreviewDto {
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(()=>SkuLinkSkipDto)
  skipped?:SkuLinkSkipDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @MaxLength(100,{each:true})
  parentSkus?:string[];
  @IsOptional() @IsBoolean() manual?:boolean;
  @IsString() @IsNotEmpty() @MaxLength(200) reference!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) parentSku!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => SkuLinkChoiceDto)
  choices?: SkuLinkChoiceDto[];
}
export class SkuActionsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({each:true}) @MaxLength(100,{each:true})
  skus!: string[];
}
export class SkuInspectionDto {
  @IsString() @IsNotEmpty() @MaxLength(100) sku!:string;
}
export class SkuQueueDto extends SkuInspectionDto {
  @IsIn(['sku','variations','fiscal']) kind!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({each:true}) @MaxLength(40,{each:true}) references!:string[];
}
export class SkuQueueUpdateDto {
  @IsString() @IsNotEmpty() @MaxLength(40) reference!:string;
  @IsIn(['RUNNING','SUCCESS','FAILED','PAUSED','REVIEW']) status!:string;
  @IsString() @MaxLength(2000) message!:string;
}
export class SkuQueueCancelDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40) reference?:string;
}
export class SelectionQueueDto {
  @IsIn(['sku','variations','fiscal']) kind!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({each:true}) @MaxLength(40,{each:true}) references!:string[];
}
