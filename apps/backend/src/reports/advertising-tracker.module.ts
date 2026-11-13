import { Module } from '@nestjs/common';
import { MercadoLivreModule } from '../mercadolivre/mercadolivre.module';
import { AdvertisingTrackerService } from './advertising-tracker.service';
@Module({imports:[MercadoLivreModule],providers:[AdvertisingTrackerService],exports:[AdvertisingTrackerService]})
export class AdvertisingTrackerModule {}
