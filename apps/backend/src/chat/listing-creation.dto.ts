import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ChatChartRowDto } from './chat.dto';
export class CreationLookupDto { @IsString() @MaxLength(100) sku!:string; }
export class CreationAttributeDto { @IsString() @MaxLength(100) id!:string; @IsString() @MaxLength(255) value!:string; @IsOptional() @IsString() @MaxLength(100) valueId?:string; }
export class CreationRowDto {
 @IsString() @MaxLength(100) sku!:string;
 @IsNumber({maxDecimalPlaces:2}) @Min(0.01) price!:number;
 @IsOptional() @IsString() @MaxLength(30) gtin?:string;
 @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @IsString({each:true}) @MaxLength(2048,{each:true}) photos?:string[];
}
export class CreationChartsDto {
 @IsString() @MaxLength(100) sku!:string;
 @IsString() @Matches(/^MLB\d+$/) categoryId!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(150) @ValidateNested({each:true}) @Type(()=>CreationLookupDto) rows!:CreationLookupDto[];
 @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>CreationAttributeDto) attributes!:CreationAttributeDto[];
}
export class CreationCopyDto extends CreationChartsDto {
 @IsString() @Matches(/^[a-f0-9]{64}$/) version!:string;
}
export class CreationChartDraftDto extends CreationCopyDto {
 @IsIn(['CLOTHING_MEASURE','BODY_MEASURE']) measureType!:'CLOTHING_MEASURE'|'BODY_MEASURE';
}
export class CreationChartSaveDto {
 @ValidateNested() @Type(()=>CreationChartDraftDto) context!:CreationChartDraftDto;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>ChatChartRowDto) rows!:ChatChartRowDto[];
}
export class CreationDraftDto {
 @IsString() @MaxLength(100) sku!:string;
 @IsString() @Matches(/^[a-f0-9]{64}$/) version!:string;
 @IsString() @MaxLength(120) title!:string;
 @IsString() @Matches(/^MLB\d+$/) categoryId!:string;
 @IsString() @IsIn(['gold_special','gold_pro']) listingTypeId!:string;
 @IsString() @IsIn(['new','used','not_specified']) condition!:string;
 @IsString() @MaxLength(10000) description!:string;
 @IsBoolean() freeShipping!:boolean;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(150) @ValidateNested({each:true}) @Type(()=>CreationRowDto) rows!:CreationRowDto[];
 @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>CreationAttributeDto) attributes!:CreationAttributeDto[];
 @IsArray() @ArrayMaxSize(12) @IsString({each:true}) @MaxLength(2048,{each:true}) photos!:string[];
 @IsOptional() @IsString() @Matches(/^\d{1,30}$/) sizeChartId?:string;
}
