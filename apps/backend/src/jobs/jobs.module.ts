import { Module } from '@nestjs/common';
import { MercadoLivreModule } from '../mercadolivre/mercadolivre.module';
import { JobsController } from './jobs.controller';
import { BlingModule } from '../bling/bling.module';
import { DailySyncService } from './daily-sync.service';
import { DailyReportsSyncService } from './daily-reports-sync.service';

@Module({
  imports: [MercadoLivreModule,BlingModule],
  providers:[DailySyncService,DailyReportsSyncService],
  controllers: [JobsController]
})
export class JobsModule {}
