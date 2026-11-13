import { Body, Controller, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CreationChartDraftDto, CreationChartSaveDto, CreationChartsDto, CreationCopyDto, CreationDraftDto, CreationLookupDto } from './listing-creation.dto';
import { ListingCreationService } from './listing-creation.service';

@Controller('chat/listing-creation')
@UseGuards(JwtAuthGuard)
export class ListingCreationController {
  constructor(private readonly creation:ListingCreationService){}
  @Post('lookup') lookup(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@Body() b:CreationLookupDto){return this.creation.lookup(a,r.user.id,b.sku);}
  @Post('copy') copy(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@Body() b:CreationCopyDto){return this.creation.generateCopy(a,r.user.id,b);}
  @Get('category/:id') category(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@Param('id') id:string){return this.creation.category(a,r.user.id,id);}
  @Post('charts') charts(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@Body() b:CreationChartsDto){return this.creation.charts(a,r.user.id,b);}
  @Post('charts/manual-drafts') chartDraft(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@Body() b:CreationChartDraftDto){return this.creation.prepareChart(a,r.user.id,b);}
  @Post('charts/drafts/:id/create') createChart(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@Param('id') id:string,@Body() b:CreationChartSaveDto){return this.creation.saveChart(a,r.user.id,id,b);}
  @Post('photos/upload') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1,fields:0}}))
  upload(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@UploadedFile() file?:{buffer:Buffer;mimetype:string}){return this.creation.upload(a,r.user.id,file);}
  @Post('prepare') prepare(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@Body() b:CreationDraftDto){return this.creation.prepare(a,r.user.id,b);}
  @Post(':id/confirm') confirm(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@Param('id') id:string){return this.creation.confirm(a,r.user.id,id);}
  @Get(':id') status(@Query('marketplaceAccountId') a:string,@Req() r:{user:{id:string}},@Param('id') id:string){return this.creation.status(a,r.user.id,id);}
}
