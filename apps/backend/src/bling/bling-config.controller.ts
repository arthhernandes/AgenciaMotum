import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
@UseGuards(JwtAuthGuard)
@Controller('bling')
export class BlingConfigController {
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}
  @Get('account')
  async account(@Query('marketplaceAccountId') id?: string) {
    const account = id ? await this.prisma.marketplaceAccount.findFirst({ where: { id, marketplace: 'BLING', active: true } }) : null;
    const configured = Boolean(this.config.get('BLING_CLIENT_ID') && this.config.get('BLING_CLIENT_SECRET') && this.config.get('BLING_REDIRECT_URI'));
    const connected = Boolean(account?.accessToken || account?.refreshToken);
    const clientId = this.config.get<string>('BLING_CLIENT_ID', '');
    return { id: account?.id, source: 'BLING', name: account?.name ?? 'Selecione uma loja', sellerId: account?.sellerId, nickname: 'Bling',
      clientId: clientId ? clientId.slice(0, 4) + '…' : null, redirectUri: this.config.get('BLING_REDIRECT_URI'),
      configured, connected, connectionStatus: connected ? 'CONNECTED' : configured ? 'CONFIGURED_NOT_CONNECTED' : 'PENDING_CONFIGURATION' };
  }
}
