import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, Optional } from '@nestjs/common';
import { ListingPricesDto } from './dto';
import { ListingPricesService } from './listing-prices.service';
import { ListingSalesService } from './listing-sales.service';
import { ListingSalesDto } from './dto';
import { assertPermissions } from '../auth/permissions';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ListingVisitsDto, ListingsQuery } from './dto';
import { ListingVisitsService } from './listing-visits.service';
import { ListingsService } from './listings.service';

@ApiTags('listings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService,private readonly visits:ListingVisitsService,@Optional() private readonly prices?:ListingPricesService,@Optional() private readonly sales?:ListingSalesService) {}
  @Post('sales') listingSales(@Query('marketplaceAccountId') accountId:string,@Body() body:ListingSalesDto){return this.sales!.find(accountId,body.ids,body.dateFrom,body.dateTo);}
  @Post('prices') listingPrices(@Query('marketplaceAccountId') accountId:string,@Body() body:ListingPricesDto){return this.prices!.find(accountId,body.ids);}

  @Post('visits')
  listingVisits(@Query('marketplaceAccountId') accountId:string,@Body() body:ListingVisitsDto){return this.visits.find(accountId,body.ids,body.dateFrom,body.dateTo);}

  @Get()
  findAll(@Query() query: ListingsQuery) {
    return this.listings.findAll(query);
  }

  @Get('grouped')
  grouped(@Query() query: ListingsQuery,@Req() req:any) { if(query.fiscalStatus)assertPermissions(req.user,'costs.view');return this.listings.findGrouped(query); }

  @Get('sales-progress')
  salesProgress(@Query() query:ListingsQuery){return this.sales!.progress(query.marketplaceAccountId!,query.progressId??'');}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.listings.findOne(id);
  }
}
