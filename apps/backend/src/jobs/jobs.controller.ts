import { BadRequestException, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoLivreSyncService } from '../mercadolivre/synchronization/mercadolivre-sync.service';
import { DailySyncService } from './daily-sync.service';

@ApiTags('sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sync')
export class JobsController {
  constructor(private readonly meliSync: MercadoLivreSyncService, private readonly prisma: PrismaService,private readonly daily:DailySyncService) {}

  @Get('daily') dailyStatus(){return this.daily.status();}
  @Get('daily/reports') dailyReports(@Query('marketplaceAccountId') accountId:string){return this.daily.reports(accountId);}

  @Post('mercadolivre/import-test')
  async importTest(@Query('marketplaceAccountId') selectedAccountId?: string) {
    const account = await this.selectedMeliAccount(selectedAccountId);
    return this.meliSync.syncAccount(account.id, undefined, 5);
  }

  @Post('mercadolivre/sync-selected')
  async syncSelected(@Query('marketplaceAccountId') selectedAccountId?: string) {
    const account = await this.selectedMeliAccount(selectedAccountId);
    return this.meliSync.syncAccount(account.id);
  }

  @Post('mercadolivre/start-selected')
  async startSelected(@Query('marketplaceAccountId') selectedAccountId?:string){const account=await this.selectedMeliAccount(selectedAccountId);return this.meliSync.startBackground(account.id);}
  @Post('mercadolivre/sync-new-today')
  async syncNewToday(@Query('marketplaceAccountId') selectedAccountId?:string){const account=await this.selectedMeliAccount(selectedAccountId);return this.meliSync.syncToday(account.id);}

  private async selectedMeliAccount(selectedAccountId?: string) {
    if (!selectedAccountId) throw new BadRequestException('Selecione uma conta antes de importar.');
    const business = await this.prisma.marketplaceAccount.findFirst({ where: { id: selectedAccountId, marketplace: 'BLING' }, select: { businessKey: true } });
    if (!business) throw new BadRequestException('Conta selecionada inválida.');
    const account = await this.prisma.marketplaceAccount.findFirst({ where: { marketplace: 'MERCADO_LIVRE', businessKey: business.businessKey, active: true, OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }] }, orderBy: { createdAt: 'asc' } });
    if (!account) throw new BadRequestException('Conecte o Mercado Livre da conta selecionada em Contas conectadas.');
    return account;
  }

  @Get('mercadolivre/progress')
  async progress(@Query('marketplaceAccountId') selectedAccountId?: string) {
    const account = await this.selectedMeliAccount(selectedAccountId);
    const execution = await this.prisma.syncExecution.findFirst({ where: { marketplaceAccountId: account.id, source: 'MERCADO_LIVRE' }, orderBy: { createdAt: 'desc' } });
    if (!execution) return null;
    const details = execution.errorDetails as { progress?: { total: number; attempted: number; percent: number } } | null;
    const finished = execution.status === 'SUCCESS' || execution.status === 'PARTIAL';
    return { id: execution.id, status: execution.status, processed: execution.itemsProcessed, errors: execution.errors, total: details?.progress?.total ?? (finished ? execution.itemsProcessed + execution.errors : null), percent: finished ? 100 : details?.progress?.percent ?? 0 };
  }

  @Post('mercadolivre/:accountId')
  syncMeli(@Param('accountId') accountId: string) {
    return this.meliSync.enqueue(accountId);
  }

  @Get('executions')
  async executions(@Query('marketplaceAccountId') marketplaceAccountId?: string) {
    const account=marketplaceAccountId?await this.prisma.marketplaceAccount.findUnique({where:{id:marketplaceAccountId},select:{businessKey:true}}):null;
    if(marketplaceAccountId&&!account)throw new BadRequestException('Conta selecionada inválida.');
    return this.prisma.syncExecution.findMany({ where: account ? { marketplaceAccount:{businessKey:account.businessKey} } : {}, orderBy: { createdAt: 'desc' }, include: { marketplaceAccount:{select:{id:true,name:true,marketplace:true,businessKey:true}} }, take: 100 });
  }

  @Get('executions/:id')
  execution(@Param('id') id: string) {
    return this.prisma.syncExecution.findUniqueOrThrow({ where: { id }, include: { marketplaceAccount: {select:{id:true,name:true,marketplace:true,businessKey:true}} } });
  }
}

