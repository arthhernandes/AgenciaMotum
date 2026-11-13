import { BadRequestException, Body, Controller, Get, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { redactCosts } from '../auth/cost-visibility';
import { ChatActionRequestDto, ChatRequestDto, ChatScopeDto, ChatRevisionDto, ChatChartChoiceDto, ChatChartDraftDto, ChatChartCreateDto,ChatBatchApplyDto,ChatBatchEditDto } from './chat.dto';
import {ChatBatchService} from './chat-batch.service';
import { ChatService } from './chat.service';
import { ChatHistoryQuery, ChatHistoryService } from './chat-history.service';
import { ChatConversationService } from './chat-conversation.service';
import { conversationContext } from './chat-context';
import { ChatFamilyPublicationService } from './chat-family-publication.service';
import { ChatSizeChartCreationService } from './chat-size-chart-creation.service';
import { ChatIntentKnowledgeService } from './chat-intent-knowledge.service';
import { IntentCode } from './chat-intent-knowledge';
import { ChatMissingSelectionDto } from './chat.dto';
import { ListingVariationSelectionDto } from './chat.dto';
import { ManualChartDraftDto } from './chat.dto';
import { ListingFiscalDto } from './chat.dto';

@ApiTags('chat') @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  @Get('actions/:id/tax-rules') fiscalTaxRules(@Param('id') id:string,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){return this.chat.fiscalTaxRules(id,accountId,req.user.id);}
  @Post('actions/:id/listing-ncm') async listingNcm(@Param('id') id:string,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){
    const result=await this.chat.analyzeFiscalNcm(id,accountId,req.user.id);
    const action=result.actions[0];
    if(!action)throw new BadRequestException('Não foi possível preparar a sugestão de NCM.');
    return {...result,actionId:action.id,draft:await this.chat.fiscalDraft(action.id,accountId,req.user.id)};
  }
  @Post('listing-fiscal') listingFiscal(@Body() body:ListingFiscalDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){return this.chat.prepareListingFiscal(accountId,req.user.id,body.reference);}
  @Post('size-charts/manual-drafts') manualChartDraft(@Body() body:ManualChartDraftDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){return this.chartCreation!.prepareManual(accountId,req.user.id,body);}
  @Get('listing-variations') listingVariations(@Query('marketplaceAccountId') accountId:string,@Query('reference') reference:string,@Req() req:{user:{id:string}}){
    if(!/^MLB\d+$/.test(reference??''))throw new BadRequestException('Informe o MLB do anúncio.');
    return this.chat.listingVariations(accountId,req.user.id,reference);
  }
  @Post('listing-variations/prepare') prepareListingVariations(@Body() body:ListingVariationSelectionDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){
    return this.chat.prepareListingVariations(accountId,req.user.id,body);
  }
  constructor(private readonly chat: ChatService, private readonly history: ChatHistoryService, private readonly conversations: ChatConversationService,@Optional() private readonly publications?:ChatFamilyPublicationService,@Optional() private readonly chartCreation?:ChatSizeChartCreationService,@Optional() private readonly intentKnowledge?:ChatIntentKnowledgeService,@Optional() private readonly batches?:ChatBatchService) {}
  @Get('batches/:id') batch(@Param('id') id:string,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){return this.batches!.snapshot(id,accountId,req.user.id);}
  private async batchConversation(batchId:string,accountId:string,userId:string,conversationId?:string){if(!conversationId)throw new BadRequestException('Informe a conversa deste lote.');const conversation=await this.conversations.open(accountId,userId,conversationId);if(!conversation.messages.some(message=>message.batchId===batchId))throw new BadRequestException('O lote não pertence a esta conversa.');}
  @Post('batches/:id/apply') async applyBatch(@Param('id') id:string,@Body() body:ChatBatchApplyDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){await this.batchConversation(id,accountId,req.user.id,body.conversationId);return this.batches!.start(id,accountId,req.user.id,body.selections);}
  @Post('batches/:id/rows/:rowId') async reviseBatch(@Param('id') id:string,@Param('rowId') rowId:string,@Body() body:ChatBatchEditDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){await this.batchConversation(id,accountId,req.user.id,body.conversationId);return this.batches!.retry(id,accountId,req.user.id,rowId,body);}
  @Get('interpretation') interpretation(){return this.intentKnowledge!.snapshot();}
  @Post('interpretation/examples') addInterpretationExample(@Body() body:{intent:IntentCode;example:string},@Req() req:{user:{id:string}}){return this.intentKnowledge!.addExample(req.user.id,body?.intent,body?.example);}
  @Post('size-charts/drafts') async chartDraft(@Body() body:ChatChartDraftDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){const context=body.actionId?await this.chat.sizeCharts(accountId,req.user.id,body.anuncio,body.actionId):undefined;return this.chartCreation!.prepare(accountId,req.user.id,{...body,requiredSizes:context?.requiredSizes});}
  @Post('size-charts/drafts/:id/create') createChart(@Param('id') id:string,@Body() body:ChatChartCreateDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){return this.chartCreation!.create(id,accountId,req.user.id,body.rows);}
  @Get('publications/:id') publication(@Param('id') id:string,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){return this.publications!.status(id,accountId,req.user.id);}
  @Get('conversations') async conversation(@Query('marketplaceAccountId') accountId: string, @Query('id') id: string, @Req() req: { user: { id: string;role?:string;permissions?:string[] } }) {
    const saved = await this.conversations.open(accountId, req.user.id, id);
    const result=req.user.role==='ADMIN'||req.user.permissions?.includes('costs.view')?saved:redactCosts(saved);
    const messages = [];
    for (const { toolContext, ...message } of result.messages) {
      if (message.actions) message.actions = await this.chat.restoreActions(message.actions, accountId, req.user.id);
      messages.push(message);
    }
    return { ...result, messages };
  }
  @Post('conversations') newConversation(@Query('marketplaceAccountId') accountId: string, @Req() req: { user: { id: string } }) {
    return this.conversations.create(accountId, req.user.id).then(row => ({ id: row.id }));
  }
  @Post('conversations/:id/scope') setScope(@Param('id') id:string,@Body() body:ChatScopeDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){return this.conversations.setScope(accountId,req.user.id,id,body);}
  @Post('actions/:id/revise') async revise(@Param('id') id:string,@Body() body:ChatRevisionDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){
    if(body.conversationId)await this.conversations.open(accountId,req.user.id,body.conversationId);
    const result=await this.chat.revise(id,accountId,req.user.id,body.colors);
    if(body.conversationId)await this.conversations.append(accountId,req.user.id,body.conversationId,[{role:'user',content:`Acrescente à prévia as cores: ${body.colors}`},{role:'assistant',content:result.message,actions:result.actions}]);
    return result;
  }
  @Get('actions/:id/fiscal') fiscalDraft(@Param('id') id:string,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){return this.chat.fiscalDraft(id,accountId,req.user.id);}
  @Post('actions/:id/ncm') async analyzeNcm(@Param('id') id:string,@Body() body:ChatActionRequestDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){
    if(!body.conversationId)throw new BadRequestException('Informe a conversa desta prévia.');
    const conversation=await this.conversations.open(accountId,req.user.id,body.conversationId);
    if(!conversation.messages.some(message=>message.actions?.some(action=>action.id===id)))throw new BadRequestException('A prévia não pertence a esta conversa.');
    const result=await this.chat.analyzeFiscalNcm(id,accountId,req.user.id);
    await this.conversations.replaceAction(accountId,req.user.id,body.conversationId,id,result.actions);
    return result;
  }
  @Post('actions/:id/fiscal') async approveFiscal(@Param('id') id:string,@Body() body:any,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){if(body.conversationId)await this.conversations.open(accountId,req.user.id,body.conversationId);const result=await this.chat.approveFiscal(id,accountId,req.user.id,body);if(body.conversationId)await this.conversations.replaceAction(accountId,req.user.id,body.conversationId,id,result.actions);return result;}
  @Get('status') status() { return this.chat.status(); }
  @Post('missing-variations/prepare') async prepareMissing(@Body() body:ChatMissingSelectionDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){
    if(!body.conversationId)throw new BadRequestException('Informe a conversa desta consulta.');
    const conversation=await this.conversations.open(accountId,req.user.id,body.conversationId);
    const preview=conversation.messages.slice().reverse().flatMap(message=>message.variantPreview??[]).find(preview=>preview.missingReview&&preview.reference===body.reference);
    if(!preview||body.skus.some(sku=>!preview.fields.some((field:any)=>field.missing&&field.sku===sku)))throw new BadRequestException('Selecione somente variações faltantes desta consulta.');
    const result=await this.chat.prepareMissingSelection(accountId,req.user.id,body.reference,body.skus);
    await this.conversations.append(accountId,req.user.id,conversation.id,[{role:'user',content:`Adicionar as variações selecionadas no anúncio ${body.reference}: ${body.skus.join(', ')}`},{role:'assistant',content:result.message,actions:result.actions}]);
    return result;
  }
  @Get('size-charts') sizeCharts(@Query('marketplaceAccountId') accountId:string,@Query('anuncio') reference:string,@Query('actionId') actionId:string,@Query('sizes') sizes:string,@Req() req:{user:{id:string}}){return this.chat.sizeCharts(accountId,req.user.id,reference,actionId,(sizes??'').slice(0,300).split(',').map(size=>size.trim()).filter(Boolean).slice(0,50));}
  @Post('actions/:id/size-chart') async selectSizeChart(@Param('id') id:string,@Body() body:ChatChartChoiceDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){
    if(body.conversationId)await this.conversations.open(accountId,req.user.id,body.conversationId);
    const result=await this.chat.selectSizeChart(id,accountId,req.user.id,body.sizeChartId);
    if(body.conversationId)await this.conversations.replaceAction(accountId,req.user.id,body.conversationId,id,result.actions);
    return result;
  }
  @Post('actions/:id/refresh') async refresh(@Param('id') id:string,@Body() body:ChatActionRequestDto,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){
    if(!body.conversationId)throw new BadRequestException('Informe a conversa desta prévia.');
    const conversation=await this.conversations.open(accountId,req.user.id,body.conversationId);
    const card=conversation.messages.flatMap(message=>message.actions??[]).find(action=>action.id===id);
    if(!card)throw new BadRequestException('A prévia não pertence a esta conversa.');
    const result=await this.chat.refreshSavedCard(card,accountId,req.user.id);
    await this.conversations.replaceAction(accountId,req.user.id,body.conversationId,id,result.actions);
    return result;
  }
  @Get('history') actions(@Query() query: ChatHistoryQuery, @Query('marketplaceAccountId') accountId: string) {
    return this.history.find(accountId, query);
  }
  @Post('messages') async message(@Body() body: ChatRequestDto, @Query('marketplaceAccountId') accountId: string, @Req() req: { user: { id: string } }) {
    const conversation = await this.conversations.open(accountId, req.user.id, body.conversationId);
    const last = body.messages[body.messages.length - 1];
    const context = conversationContext(conversation.messages, last);
    const result = await this.chat.reply(context.messages, accountId, req.user.id, {...context,scope:conversation.scope,sizeChartId:body.sizeChartId});
    await this.conversations.append(accountId, req.user.id, conversation.id, [{ role: last.role, content: last.content }, { role: 'assistant', content: result.message,batchId:'batchId' in result?result.batchId:undefined,variantPreview:'variantPreview' in result?result.variantPreview:undefined, actions: result.actions, operations: result.operations, toolContext: result.toolContext }]);
    if('batchId' in result&&result.batchId)await this.batches!.bind(result.batchId,accountId,req.user.id,conversation.id);
    const { toolContext, ...response } = result;
    return { ...response, conversationId: conversation.id };
  }
  @Post('actions/:id/confirm') async confirm(@Param('id') id: string, @Body() body: ChatActionRequestDto, @Query('marketplaceAccountId') accountId: string, @Req() req: { user: { id: string } }) {
    if (body.conversationId) await this.conversations.open(accountId, req.user.id, body.conversationId);
    const result = await this.chat.confirm(id, accountId, req.user.id);
    return this.saveActionResult(result, accountId, req.user.id, body.conversationId);
  }
  @Post('actions/:id/cancel') async cancel(@Param('id') id: string, @Body() body: ChatActionRequestDto, @Query('marketplaceAccountId') accountId: string, @Req() req: { user: { id: string } }) {
    if (body.conversationId) await this.conversations.open(accountId, req.user.id, body.conversationId);
    const result = await this.chat.cancel(id, accountId, req.user.id);
    return this.saveActionResult(result, accountId, req.user.id, body.conversationId);
  }
  private async saveActionResult<T extends {message: string}>(result: T, accountId: string, userId: string, conversationId?: string) {
    if (conversationId) {
      try { await this.conversations.append(accountId, userId, conversationId, [{ role: 'assistant', content: result.message }]); }
      catch { return { ...result, message: `${result.message}\nNão foi possível salvar esta resposta na conversa. O resultado permanece no histórico de ações.` }; }
    }
    return result;
  }
}
