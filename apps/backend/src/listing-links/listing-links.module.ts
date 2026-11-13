import { Module } from '@nestjs/common';
import { ListingLinksController } from './listing-links.controller';
import { ListingLinksService } from './listing-links.service';
import { ChatModule } from '../chat/chat.module';
import { SkuLinkService } from './sku-link.service';
import { SkuActionsService } from './sku-actions.service';

@Module({ imports: [ChatModule], controllers: [ListingLinksController], providers: [ListingLinksService, SkuLinkService, SkuActionsService], exports: [ListingLinksService] })
export class ListingLinksModule {}
