import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
export class EditorAttributeDto {
  @IsString() @MaxLength(80) id!:string;
  @IsString() @MinLength(1) @MaxLength(300) value!:string;
  @IsOptional() @IsString() @MaxLength(100) valueId?:string;
}
export class EditorVariationPicturesDto {
  @IsString() @Matches(/^\d+$/) variationId!:string;
  @IsArray() @ArrayMaxSize(12) @IsString({each:true}) @Matches(/^[\w-]{1,150}$/,{each:true}) pictures!:string[];
}
export class EditorOfferDto {
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(()=>EditorVariationPicturesDto) variationPictures?:EditorVariationPicturesDto[];
  @IsOptional() @IsString() @MinLength(1) @MaxLength(10000) description?:string;
  @IsString() @Matches(/^MLB\d+$/) reference!:string;
  @IsOptional() @IsArray() @ArrayMaxSize(6000) @IsString({each:true}) @MaxLength(2000,{each:true}) pictures?:string[];
  @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0.01) price?:number;
  @IsOptional() @IsInt() @Min(0) stock?:number;
  @IsOptional() @IsIn(['active','paused']) status?:string;
}
export class ListingEditorDto {
  @IsString() @Matches(/^MLB\d+$/) reference!:string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) version!:string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?:string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>EditorAttributeDto) attributes?:EditorAttributeDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(()=>EditorOfferDto) offers?:EditorOfferDto[];
}
