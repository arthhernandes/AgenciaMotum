import { ListingSalesService } from './listing-sales.service';
import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { ListingVisitsService } from './listing-visits.service';
import { MercadoLivreModule } from '../mercadolivre/mercadolivre.module';
import { ListingFiscalStateService } from './listing-fiscal-state.service';
import { BlingModule } from '../bling/bling.module';
import { ProductCostsService } from '../products/product-costs.service';
import { ListingPricesService } from './listing-prices.service';

@Module({ imports:[MercadoLivreModule,BlingModule],controllers: [ListingsController], providers: [ListingsService,ListingVisitsService,ListingFiscalStateService,ProductCostsService,ListingPricesService,ListingSalesService], exports: [ListingsService] })
export class ListingsModule {}
