import { SkuMissingRemovalService, SkuMissingRemovalController } from './sku-missing-removal.service';
import { ListingCreationController } from './listing-creation.controller';
import { ListingCreationService } from './listing-creation.service';
import { ListingCopyService } from './listing-copy.service';
import { ListingDuplicationController } from './listing-duplication.controller';
import { ListingDuplicationService } from './listing-duplication.service';
import { ListingDuplicationTitlesService } from './listing-duplication-titles.service';
import { ChatFiscalService } from './chat-fiscal.service';
import { ChatBatchService } from './chat-batch.service';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ProductsModule } from '../products/products.module';
import { ListingsModule } from '../listings/listings.module';
import { BlingModule } from '../bling/bling.module';
import { MercadoLivreModule } from '../mercadolivre/mercadolivre.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatMarketplaceService } from './chat-marketplace.service';
import { ChatHistoryService } from './chat-history.service';
import { ChatConversationService } from './chat-conversation.service';
import { ChatFamilyPublicationService } from './chat-family-publication.service';
import { ChatSizeChartCreationService } from './chat-size-chart-creation.service';
import { ChatPendingActionsService } from './chat-pending-actions.service';
import { ListingEditorService } from './listing-editor.service';
import { ListingEditorController } from './listing-editor.controller';
import { ChatIntentKnowledgeService } from './chat-intent-knowledge.service';

@Module({ imports: [HttpModule, ProductsModule, ListingsModule, BlingModule, MercadoLivreModule], controllers: [SkuMissingRemovalController,ListingCreationController,ListingDuplicationController,ChatController,ListingEditorController], exports: [ChatMarketplaceService, ChatPendingActionsService], providers: [SkuMissingRemovalService,ListingCopyService,ListingCreationService,ListingDuplicationService,ListingDuplicationTitlesService,ListingEditorService,ChatBatchService,ChatFiscalService,ChatService, ChatMarketplaceService, ChatHistoryService, ChatConversationService,ChatFamilyPublicationService,ChatSizeChartCreationService,ChatPendingActionsService,ChatIntentKnowledgeService] })
export class ChatModule {}
