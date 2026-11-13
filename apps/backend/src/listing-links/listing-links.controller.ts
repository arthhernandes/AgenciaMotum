import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Request, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ManualLinkDto } from './dto';
import { ListingLinksService } from './listing-links.service';
import { SkuLinkService } from './sku-link.service';
import { SkuLinkPreviewDto, SkuActionsDto, SkuInspectionDto, SkuQueueDto, SkuQueueUpdateDto, SkuQueueCancelDto, SelectionQueueDto } from './sku-link.dto';
import { SkuActionsService } from './sku-actions.service';

@ApiTags('listing-links')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('listing-links')
export class ListingLinksController {
  constructor(private readonly links: ListingLinksService, private readonly skuLinks: SkuLinkService, private readonly skuActions:SkuActionsService) {}

  @Get('sku/photo/:id')
  async photo(@Param('id') id:string,@Res() response:Response){
    if(!/^\d+-ML[A-Z]\d+_\d+$/.test(id)||id.length>100)throw new BadRequestException('Identificador de foto inválido.');
    try{
      const image=await fetch(`https://http2.mlstatic.com/D_${id}-O.jpg`,{signal:AbortSignal.timeout(20000),redirect:'error'});
      const type=image.headers.get('content-type')||'';
      if(!image.ok||!/^image\/(jpeg|png|webp|avif)/i.test(type))throw new Error('Invalid image');
      const buffer=Buffer.from(await image.arrayBuffer());
      if(buffer.length>20*1024*1024)throw new Error('Image too large');
      response.setHeader('Content-Type',type);response.setHeader('Cache-Control','private, max-age=300');response.send(buffer);
    }catch{throw new ServiceUnavailableException('Não foi possível carregar a imagem para copiar. Tente novamente.');}
  }

  @Post('sku/actions')
  skuTargets(@Body() dto:SkuActionsDto,@Query('marketplaceAccountId') accountId:string){return this.skuActions.find(accountId,dto.skus);}

  @Post('sku/audit')
  inspectSku(@Body() dto:SkuInspectionDto,@Query('marketplaceAccountId') accountId:string){return this.skuActions.inspect(accountId,dto.sku.trim());}

  @Get('sku/queues')
  queues(@Query('marketplaceAccountId') accountId:string,@Request() req:{user:{id:string}}){return this.skuActions.queues(accountId,req.user.id);}

  @Post('sku/queues')
  createQueue(@Body() dto:SkuQueueDto,@Query('marketplaceAccountId') accountId:string,@Request() req:{user:{id:string}}){return this.skuActions.createQueue(accountId,req.user.id,dto.sku.trim(),dto.kind,dto.references);}

  @Post('sku/queues/selection')
  selectionQueue(@Body() dto:SelectionQueueDto,@Query('marketplaceAccountId') accountId:string,@Request() req:{user:{id:string}}){return this.skuActions.createSelectionQueue(accountId,req.user.id,dto.kind,dto.references);}

  @Post('sku/queues/:id')
  updateQueue(@Param('id') id:string,@Body() dto:SkuQueueUpdateDto,@Query('marketplaceAccountId') accountId:string,@Request() req:{user:{id:string}}){return this.skuActions.updateQueue(accountId,req.user.id,id,dto.reference,dto.status,dto.message);}

  @Post('sku/queues/:id/cancel')
  cancelQueue(@Param('id') id:string,@Body() dto:SkuQueueCancelDto,@Query('marketplaceAccountId') accountId:string,@Request() req:{user:{id:string}}){return this.skuActions.cancelQueue(accountId,req.user.id,id,dto.reference);}

  @Post('sku/preview')
  previewSku(@Body() dto: SkuLinkPreviewDto, @Query('marketplaceAccountId') accountId: string, @Request() req: { user: { id: string } }) {
    return this.skuLinks.preview(accountId, req.user.id, dto);
  }

  @Post('sku/manual-options')
  manualSkuOptions(@Body() dto:SkuLinkPreviewDto,@Query('marketplaceAccountId') accountId:string,@Request() req:{user:{id:string}}){
    return this.skuLinks.manualOptions(accountId,req.user.id,dto);
  }

  @Post('sku/:id/confirm')
  confirmSku(@Param('id') id: string, @Query('marketplaceAccountId') accountId: string, @Request() req: { user: { id: string } }) {
    return this.skuLinks.confirm(accountId, req.user.id, id);
  }

  @Post('manual')
  manual(@Body() dto: ManualLinkDto, @Request() req: { user?: { id: string } }) {
    return this.links.manualLink(dto, req.user?.id);
  }

  @Delete(':id')
  unlink(@Param('id') id: string, @Request() req: { user?: { id: string } }) {
    return this.links.unlink(id, req.user?.id);
  }
}
