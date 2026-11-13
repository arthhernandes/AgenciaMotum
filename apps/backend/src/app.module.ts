import { Module } from '@nestjs/common';
import { ReportsModule } from './reports/reports.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CostVisibilityInterceptor } from './auth/cost-visibility';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { ListingLinksModule } from './listing-links/listing-links.module';
import { ListingsModule } from './listings/listings.module';
import { MarketplaceAccountsModule } from './marketplace-accounts/marketplace-accounts.module';
import { MercadoLivreModule } from './mercadolivre/mercadolivre.module';
import { BlingModule } from './bling/bling.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductVariantsModule } from './product-variants/product-variants.module';
import { ProductsModule } from './products/products.module';
import { UsersModule } from './users/users.module';
import { ChatModule } from './chat/chat.module';
import { NcmModule } from './ncm/ncm.module';
import { OperationsModule } from './operations/operations.controller';

@Module({
  providers:[{provide:APP_INTERCEPTOR,useClass:CostVisibilityInterceptor}],
  imports: [
    ReportsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env']
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    ProductVariantsModule,
    MarketplaceAccountsModule,
    MercadoLivreModule,
    BlingModule,
    ListingsModule,
    ListingLinksModule,
    AuditModule,
    DashboardModule,
    JobsModule,
    HealthModule,
    ChatModule,
    NcmModule,
    OperationsModule
  ]
})
export class AppModule {}
