import { Module } from '@nestjs/common';
import { MarketplaceAccountsController } from './marketplace-accounts.controller';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { MercadoLivreModule } from '../mercadolivre/mercadolivre.module';
import { ConnectionStatusService } from './connection-status.service';

@Module({
  imports: [MercadoLivreModule],
  controllers: [MarketplaceAccountsController],
  providers: [MarketplaceAccountsService,ConnectionStatusService],
  exports: [MarketplaceAccountsService]
})
export class MarketplaceAccountsModule {}
