import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MercadoLivreAuthController } from './auth/mercadolivre-auth.controller';
import { MercadoLivreAuthService } from './auth/mercadolivre-auth.service';
import { MercadoLivreClient } from './mercadolivre.client';
import { MercadoLivreSyncService } from './synchronization/mercadolivre-sync.service';
import { ListingMatcherService } from './synchronization/listing-matcher.service';

@Module({
  imports: [
    HttpModule.register({ timeout: 15000 }),
    AuditModule
  ],
  controllers: [MercadoLivreAuthController],
  providers: [MercadoLivreClient, MercadoLivreAuthService, MercadoLivreSyncService, ListingMatcherService],
  exports: [MercadoLivreClient, MercadoLivreAuthService, MercadoLivreSyncService, ListingMatcherService]
})
export class MercadoLivreModule {}
