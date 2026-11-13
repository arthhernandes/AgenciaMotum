import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, IsObject, IsOptional, IsNumber, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class ChatMessageDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @IsString() @MinLength(1) @MaxLength(4000) content!: string;
}

export class ChatRequestDto {
  @IsOptional() @IsString() @Matches(/^\d{1,30}$/) sizeChartId?:string;
  @IsOptional() @IsString() @MaxLength(100) conversationId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}

export class ChatActionRequestDto {
  @IsOptional() @IsString() @MaxLength(100) conversationId?: string;
}
export class ChatMissingSelectionDto extends ChatActionRequestDto{
 @IsString() @Matches(/^MLB\d+$/) reference!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({each:true}) @MaxLength(100,{each:true}) skus!:string[];
}
export class ListingVariationSelectionDto extends ChatActionRequestDto {
 @IsString() @Matches(/^MLB\d+$/) reference!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsString({each:true}) @MaxLength(100,{each:true}) skus!:string[];
 @IsOptional() @IsNumber() price?: number;
 @IsOptional() @IsString() @Matches(/^\d{1,30}$/) sizeChartId?: string;
}
export class ChatBatchSelectionDto{
 @IsString() @MaxLength(100) rowId!:string;
 @IsObject() actionIds!:Record<string,string>;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsIn(['variations','fiscal','price'],{each:true}) stages!:Array<'variations'|'fiscal'|'price'>;
}
export class ChatBatchApplyDto extends ChatActionRequestDto{
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({each:true}) @Type(()=>ChatBatchSelectionDto) selections!:ChatBatchSelectionDto[];
}
export class ChatBatchEditDto extends ChatActionRequestDto{
 @IsOptional() @IsString() @MaxLength(500) reference?:string;
 @IsOptional() @IsNumber() price?:number;
 @IsOptional() @IsIn(['bling','fixed']) priceSource?:'bling'|'fixed';
 @IsOptional() @IsString() @Matches(/^\d{1,30}$/) sizeChartId?:string;
 @IsOptional() @IsString() @Matches(/^\d+(?:\.\d+)?$/) baseSku?:string;
}
export class ChatScopeDto {
  @IsIn(['listing','product','multiple']) mode!:'listing'|'product'|'multiple';
  @IsString() @MinLength(1) @MaxLength(4000) reference!:string;
}
export class ChatRevisionDto extends ChatActionRequestDto {
  @IsString() @MinLength(1) @MaxLength(200) colors!:string;
}
export class ChatChartChoiceDto extends ChatActionRequestDto {
  @IsString() @Matches(/^\d{1,30}$/) sizeChartId!:string;
}
export class ChatChartDraftDto {
  @IsString() @MinLength(1) @MaxLength(300) anuncio!:string;
  @IsOptional() @IsString() @MaxLength(100) actionId?:string;
  @IsOptional() @IsString() @MaxLength(12000) text?:string;
  @IsOptional() @IsString() @MaxLength(7100000) image?:string;
  @IsIn(['CLOTHING_MEASURE','BODY_MEASURE']) measureType!:'CLOTHING_MEASURE'|'BODY_MEASURE';
}
export class ManualChartDraftDto {
  @IsString() @Matches(/^MLB\d+$/) anuncio!: string;
  @IsIn(['CLOTHING_MEASURE','BODY_MEASURE']) measureType!: 'CLOTHING_MEASURE' | 'BODY_MEASURE';
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({each:true}) @MaxLength(30,{each:true}) requiredSizes?: string[];
}
export class ListingFiscalDto {
  @IsString() @Matches(/^MLB\d+$/) reference!: string;
}
export class ChatChartRowDto {
  @IsString() @MinLength(1) @MaxLength(30) size!:string;
  @IsOptional() @IsString() @MaxLength(40) equivalentId?:string|null;
  @IsObject() measurements!:Record<string,number|null>;
}
export class ChatChartCreateDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>ChatChartRowDto) rows!:ChatChartRowDto[];
}
