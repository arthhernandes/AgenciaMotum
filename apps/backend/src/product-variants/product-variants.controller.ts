import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ProductVariantsService } from './product-variants.service';

@ApiTags('product-variants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('product-variants')
export class ProductVariantsController {
  constructor(private readonly variants: ProductVariantsService) {}

  @Get(':id/listings')
  listings(@Param('id') id: string) {
    return this.variants.listings(id);
  }
}
