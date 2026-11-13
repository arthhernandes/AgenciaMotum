import { Body, Controller, Get, Module, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { FiscalTemplateDto, PendingQuery } from './operations.dto';
import { OperationsService } from './operations.service';

class ArchiveTemplateDto { @IsString() @IsNotEmpty() @MaxLength(100) version!:string; }
@Controller('operations')
@UseGuards(JwtAuthGuard)
export class OperationsController {
  constructor(private readonly operations:OperationsService){}
  @Get('pending') pending(@Query('marketplaceAccountId') accountId:string,@Query() query:PendingQuery){return this.operations.pending(accountId,query);}
  @Get('fiscal-templates') templates(@Query('marketplaceAccountId') accountId:string){return this.operations.templates(accountId);}
  @Post('fiscal-templates') create(@Query('marketplaceAccountId') accountId:string,@Request() req:{user:{id:string}},@Body() body:FiscalTemplateDto){return this.operations.saveTemplate(accountId,req.user.id,body);}
  @Post('fiscal-templates/:id') edit(@Param('id') id:string,@Query('marketplaceAccountId') accountId:string,@Request() req:{user:{id:string}},@Body() body:FiscalTemplateDto){return this.operations.saveTemplate(accountId,req.user.id,body,id);}
  @Post('fiscal-templates/:id/archive') archive(@Param('id') id:string,@Query('marketplaceAccountId') accountId:string,@Request() req:{user:{id:string}},@Body() body:ArchiveTemplateDto){return this.operations.archiveTemplate(accountId,req.user.id,id,body.version);}
}
@Module({controllers:[OperationsController],providers:[OperationsService]})
export class OperationsModule {}
