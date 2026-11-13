import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductCostsService } from './product-costs.service';
import { BlingModule } from '../bling/bling.module';

@Module({
  imports:[BlingModule],
  controllers: [ProductsController],
  providers: [ProductsService,ProductCostsService],
  exports: [ProductsService]
})
export class ProductsModule {}
