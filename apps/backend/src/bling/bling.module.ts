import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { BlingAuthController } from './bling-auth.controller';
import { BlingAuthService } from './bling-auth.service';
import { BlingConfigController } from './bling-config.controller';
import { BlingSyncController } from './synchronization/bling-sync.controller';
import { BlingSyncService } from './synchronization/bling-sync.service';
import { MercadoLivreModule } from '../mercadolivre/mercadolivre.module';

@Module({
  imports: [HttpModule.register({ timeout: 15000 }), MercadoLivreModule],
  controllers: [BlingAuthController, BlingConfigController, BlingSyncController],
  providers: [BlingAuthService, BlingSyncService],
  exports: [BlingSyncService]
})
export class BlingModule {}
