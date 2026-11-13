import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ProductQueryDto } from './dto';
import { ProductsService } from './products.service';
import { ProductCostsService } from './product-costs.service';
class ProductCostsDto { @IsOptional() @IsBoolean() refresh?:boolean; }

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService,private readonly costs:ProductCostsService) {}

  @Post(':id/costs')
  productCosts(@Param('id') id:string,@Query('marketplaceAccountId') accountId:string,@Body() body:ProductCostsDto){return this.costs.find(accountId,id,body.refresh);}

  @Get()
  findAll(@Query() query: ProductQueryDto) {
    return this.products.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.products.findOne(id);
  }

  @Get(':id/listings')
  listings(@Param('id') id: string) {
    return this.products.listings(id);
  }
}
