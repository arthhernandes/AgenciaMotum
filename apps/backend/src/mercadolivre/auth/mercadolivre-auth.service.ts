import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  expires_in: number;
  user_id?: number;
}

@Injectable()
export class MercadoLivreAuthService {
  private readonly logger = new Logger(MercadoLivreAuthService.name);
  private readonly refreshing = new Map<string,Promise<string>>();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async exchangeCode(accountId: string, code: string) {
    const config = await this.accountConfig(accountId);
    const tokens = await this.requestToken({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri
    });
    await this.saveTokens(accountId, tokens);
    return { accountId, connected: true, automaticRenewal: Boolean(tokens.refresh_token) };
  }

  async getValidAccessToken(accountId: string, forceRefresh = false) {
    const pending = this.refreshing.get(accountId);
    if (pending) return pending;
    const account = await this.prisma.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId } });
    if (!forceRefresh && account.accessToken && account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now() + 60_000) {
      return account.accessToken;
    }
    if (!account.refreshToken) return account.accessToken ?? '';
    // Recheck after the asynchronous read: another caller may already be renewing.
    const started = this.refreshing.get(accountId);
    if (started) return started;
    const task = this.refresh(accountId,forceRefresh,account.accessToken);
    this.refreshing.set(accountId,task);
    try { return await task; } finally { this.refreshing.delete(accountId); }
  }

  private async refresh(accountId:string,forceRefresh:boolean,observedToken:string|null) {
    const config = await this.accountConfig(accountId);
    try {
      return await this.prisma.$transaction(async tx => {
        // Refresh tokens are single-use. Serialize renewal across processes as well.
        await tx.$queryRaw`SELECT "id" FROM "MarketplaceAccount" WHERE "id" = ${accountId} FOR UPDATE`;
        const latest = await tx.marketplaceAccount.findUniqueOrThrow({where:{id:accountId}});
        if (latest.accessToken && latest.tokenExpiresAt && latest.tokenExpiresAt.getTime() > Date.now()+60_000 && (!forceRefresh || latest.accessToken !== observedToken)) return latest.accessToken;
        if (!latest.refreshToken) return latest.accessToken ?? '';
        const tokens = await this.requestToken({grant_type:'refresh_token',client_id:config.clientId,client_secret:config.clientSecret,refresh_token:latest.refreshToken});
        await this.saveTokens(accountId,tokens,tx);
        this.logger.log(`token refreshed accountId=${accountId}`);
        return tokens.access_token;
      },{maxWait:20000,timeout:25000});
    } catch(error) {
      // A reconnection or another renewal may have completed while we were waiting.
      const latest = await this.prisma.marketplaceAccount.findUniqueOrThrow({where:{id:accountId}});
      if (latest.accessToken && latest.accessToken !== observedToken && latest.tokenExpiresAt && latest.tokenExpiresAt.getTime() > Date.now()+60_000) return latest.accessToken;
      const response=(error as any)?.response;
      const reason=typeof response?.data?.error==='string'&&/^[a-z_]{1,60}$/.test(response.data.error)?response.data.error:'renewal_unavailable';
      this.logger.warn(`token renewal failed accountId=${accountId} status=${response?.status??'unknown'} reason=${reason}`);
      throw error;
    }
  }

  async accountConfig(accountId: string) {
    const account = await this.prisma.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId }, select: { businessKey: true, marketplace: true, active: true } });
    if ((account.marketplace && account.marketplace !== 'MERCADO_LIVRE') || account.active === false) throw new BadRequestException('Selecione uma conta Mercado Livre ativa.');
    const settings = {
      clientId: this.config.get<string>('MELI_CLIENT_ID'),
      clientSecret: this.config.get<string>('MELI_CLIENT_SECRET'),
      redirectUri: this.config.get<string>('MELI_REDIRECT_URI') || this.config.get<string>('MELI_REDIRECT_URI')
    };
    if(!settings.clientId?.trim()||!settings.clientSecret?.trim()||!settings.redirectUri?.trim())throw new BadRequestException({code:'MELI_OAUTH_NOT_CONFIGURED',message:`O aplicativo do Mercado Livre da loja selecionada não está configurado. Preencha Client ID, Client Secret e URL de retorno antes de conectar.`});
    return settings;
  }

  private async requestToken(data: Record<string, string | undefined>) {
    const response = await firstValueFrom(this.http.post<TokenResponse>('https://api.mercadolibre.com/oauth/token', new URLSearchParams(data as Record<string, string>), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000
    }));
    const tokens=response.data;
    const expiresIn=Number(tokens.expires_in);
    const hasRefresh=typeof tokens.refresh_token==='string'&&!!tokens.refresh_token;
    if(typeof tokens.access_token!=='string'||!tokens.access_token||(!hasRefresh&&data.grant_type!=='authorization_code')||!Number.isFinite(expiresIn)||expiresIn<=0){
      this.logger.warn(`invalid OAuth token response status=${response.status} hasAccess=${!!tokens.access_token} hasRefresh=${!!tokens.refresh_token} expiryType=${typeof tokens.expires_in} validExpiry=${Number.isFinite(expiresIn)&&expiresIn>0}`);
      throw new Error('Invalid Mercado Livre token response');
    }
    if(!hasRefresh)this.logger.warn(`OAuth authorization has no renewal token offlineAccess=${tokens.scope?.split(' ').includes('offline_access')??false}`);
    return {...tokens,expires_in:expiresIn};
  }

  private saveTokens(accountId: string, tokens: TokenResponse, database: Prisma.TransactionClient | PrismaService = this.prisma) {
    return database.marketplaceAccount.update({
      where: { id: accountId },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        sellerId: tokens.user_id ? String(tokens.user_id) : undefined
      }
    });
  }
}
