import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { getBlingOAuthConfig } from './bling-oauth.config';
interface Tokens { access_token: string; refresh_token: string; expires_in: number; }
@Injectable()
export class BlingAuthService {
  private readonly renewals = new Map<string, Promise<string>>();
  constructor(private readonly prisma: PrismaService, private readonly http: HttpService, private readonly config: ConfigService) {}
  async account(accountId?: string) {
    if (!accountId) throw new BadRequestException('Selecione uma loja.');
    const account = await this.prisma.marketplaceAccount.findFirst({ where: { id: accountId, marketplace: 'BLING', active: true } });
    if (!account) throw new BadRequestException('Loja não encontrada ou desativada.');
    return account;
  }
  async exchangeCode(code: string, accountId?: string) {
    const account = await this.account(accountId);
    const oauth = getBlingOAuthConfig(this.config, account.id);
    let tokens: Tokens;
    try { tokens = await this.requestToken(account.id, { grant_type: 'authorization_code', code, redirect_uri: oauth.redirectUri }); }
    catch { throw new BadRequestException('Não foi possível autorizar o Bling. Inicie a conexão novamente.'); }
    await this.saveToken(tokens.access_token, tokens.expires_in, tokens.refresh_token, account.id);
    return { accountId: account.id, connected: true };
  }
  async refreshAccess(accountId: string): Promise<string> {
    const pending = this.renewals.get(accountId);
    if (pending) return pending;
    const task = this.renewAccount(accountId);
    this.renewals.set(accountId, task);
    try { return await task; } finally { this.renewals.delete(accountId); }
  }
  private async renewAccount(accountId: string) {
    const observed = await this.account(accountId);
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "MarketplaceAccount" WHERE "id" = ${accountId} FOR UPDATE`;
        const latest = await tx.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId } });
        if (latest.accessToken && latest.accessToken !== observed.accessToken && latest.tokenExpiresAt && latest.tokenExpiresAt.getTime() > Date.now() + 60000) return latest.accessToken;
        if (!latest.refreshToken) throw new Error('Missing refresh token');
        const tokens = await this.requestToken(accountId, { grant_type: 'refresh_token', refresh_token: latest.refreshToken });
        await tx.marketplaceAccount.update({ where: { id: accountId }, data: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000) } });
        return tokens.access_token;
      }, { maxWait: 20000, timeout: 25000 });
    } catch { throw new Error('Reconecte o Bling da loja ' + observed.name + ': a autorização não pôde ser renovada.'); }
  }
  private async requestToken(accountId: string, data: Record<string, string>) {
    const oauth = getBlingOAuthConfig(this.config, accountId);
    const response = await firstValueFrom(this.http.post<Tokens>(oauth.tokenUrl, new URLSearchParams(data), {
      timeout: 15000, headers: { Authorization: 'Basic ' + Buffer.from(oauth.clientId + ':' + oauth.clientSecret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
    }));
    const tokens = response.data;
    if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 0) throw new Error('Invalid Bling token response');
    return { ...tokens, expires_in: Number(tokens.expires_in) };
  }
  async saveToken(accessToken: string, expiresIn?: number, refreshToken?: string, accountId?: string) {
    const account = await this.account(accountId);
    if (!accessToken || !refreshToken || !expiresIn || expiresIn <= 0) throw new BadRequestException('Resposta de autorização incompleta.');
    await this.prisma.marketplaceAccount.update({ where: { id: account.id }, data: { accessToken, refreshToken, tokenExpiresAt: new Date(Date.now() + expiresIn * 1000) } });
    return { accountId: account.id, connected: true };
  }
}
