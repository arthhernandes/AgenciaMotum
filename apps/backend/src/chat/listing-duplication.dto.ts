import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DuplicationVariantDto {
  @IsString() @Matches(/^MLB\d+(?::\d+)?$/) key!:string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @IsString({each:true}) @Matches(/^[\w-]{1,150}$/,{each:true}) photos?:string[];
}

export class DuplicationTitlesDto {
  @IsOptional() @IsBoolean() manual?:boolean;
  @IsOptional() @IsString() @MaxLength(100) destinationAccountId?:string;
  @IsString() @Matches(/^MLB\d+$/) reference!:string;
  @IsInt() @Min(1) @Max(10) count!:number;
}
export class DuplicationPrepareDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(()=>DuplicationVariantDto) variants?:DuplicationVariantDto[];
  @IsOptional() @IsString() @MaxLength(100) destinationAccountId?:string;
  @IsString() @Matches(/^MLB\d+$/) reference!:string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) version!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({each:true}) @MaxLength(120,{each:true}) titles!:string[];
}
