import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { DuplicationPrepareDto, DuplicationTitlesDto } from './listing-duplication.dto';
import { ListingDuplicationService } from './listing-duplication.service';

@Controller('chat/listing-duplication')
@UseGuards(JwtAuthGuard)
export class ListingDuplicationController {
  constructor(private readonly duplication:ListingDuplicationService){}
  @Get('destinations') destinations(@Req() req:{user:{id:string}}){return this.duplication.destinations(req.user.id);}
  @Get() latest(@Query('marketplaceAccountId') account:string,@Query('reference') reference:string,@Query('destinationAccountId') destination:string,@Req() req:{user:{id:string}}){return this.duplication.latest(account,req.user.id,reference,destination);}
  @Post('titles') titles(@Query('marketplaceAccountId') account:string,@Req() req:{user:{id:string}},@Body() body:DuplicationTitlesDto){return this.duplication.titles(account,req.user.id,body.reference,body.count,body.destinationAccountId,body.manual);}
  @Post('options') options(@Query('marketplaceAccountId') account:string,@Req() req:{user:{id:string}},@Body() body:DuplicationTitlesDto){return this.duplication.titles(account,req.user.id,body.reference,body.count,body.destinationAccountId,true);}
  @Post('prepare') prepare(@Query('marketplaceAccountId') account:string,@Req() req:{user:{id:string}},@Body() body:DuplicationPrepareDto){return this.duplication.prepare(account,req.user.id,body);}
  @Post(':id/confirm') confirm(@Query('marketplaceAccountId') account:string,@Req() req:{user:{id:string}},@Param('id') id:string){return this.duplication.confirm(account,req.user.id,id);}
  @Get(':id') status(@Query('marketplaceAccountId') account:string,@Req() req:{user:{id:string}},@Param('id') id:string){return this.duplication.status(account,req.user.id,id);}
  @Post(':id/resume') resume(@Query('marketplaceAccountId') account:string,@Req() req:{user:{id:string}},@Param('id') id:string){return this.duplication.resume(account,req.user.id,id);}
}
