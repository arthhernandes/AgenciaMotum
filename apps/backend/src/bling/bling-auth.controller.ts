import { BadRequestException, Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { OAuthStateService } from '../auth/oauth-state.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { BlingAuthService } from './bling-auth.service';
import { getBlingOAuthConfig } from './bling-oauth.config';

@ApiTags('bling-auth')
@Controller('bling/auth')
export class BlingAuthController {
  constructor(private readonly config: ConfigService, private readonly auth: BlingAuthService, private readonly states:OAuthStateService) {}

  @Get('authorize')
  @UseGuards(JwtAuthGuard)
  async authorize(@Query('account') account: string, @Query('debug') debug: string | undefined, @Res() res: Response, @Query('format') format:string|undefined, @Req() req:{user:{id:string}}) {
    const selected = await this.auth.account(account);
    const accountSlug = selected.id;
    let authUrl: string;
    let accountName = accountSlug;
    try {
      const oauth = getBlingOAuthConfig(this.config, accountSlug);
      accountName = oauth.accountName;
      const state=await this.states.create('BLING',accountSlug,req.user.id);
      authUrl = this.buildBlingAuthUrl(oauth,state);
    } catch (error) {
      const response = error instanceof BadRequestException ? error.getResponse() : { message: 'Falha ao montar autorização Bling.' };
      return res.status(400).json(response);
    }
    if (debug) {
      const oauth = getBlingOAuthConfig(this.config, accountSlug);
      const safeClient = oauth.clientId ? `${oauth.clientId.slice(0, 18)}...` : 'vazio';
      return res.type('html').send(`
        <h2>Debug OAuth Bling - ${this.escape(accountName)}</h2>
        <p><strong>Conta:</strong> ${this.escape(accountSlug)}</p>
        <p><strong>Client ID usado:</strong> ${this.escape(safeClient)}</p>
        <p><strong>Redirect URI enviado:</strong><br><code>${this.escape(oauth.redirectUri)}</code></p>
        <p><strong>Cadastre exatamente esta URL no aplicativo Bling deste Client ID.</strong></p>
        <p><strong>URL de autorização gerada:</strong></p>
        <textarea style="width:100%;height:120px;">${this.escape(authUrl)}</textarea>
        <p><a href="${this.escape(authUrl)}">Testar autorização agora</a></p>
      `);
    }
    return format==='json'?res.json({url:authUrl}):res.redirect(authUrl);
  }

  @Get('callback')
  async callback(
    @Query('access_token') accessToken: string | undefined,
    @Query('expires_in') expiresIn: string | undefined,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Query('error_description') oauthErrorDescription: string | undefined,
    @Res() res: Response
  ) {
    if (oauthError) {
      return this.redirectToAccounts(res, 'error', oauthErrorDescription || oauthError);
    }
    if (code) {
      try {
        const account=await this.states.consume('BLING',state);
        await this.auth.exchangeCode(code, account);
        return this.redirectToAccounts(res, 'connected');
      } catch (error) {
        const response = typeof error === 'object' && error && 'getResponse' in error
          ? (error as { getResponse: () => unknown }).getResponse()
          : { message: 'Falha ao autenticar Bling.' };
        const message = typeof response === 'object' && response && 'message' in response
          ? String((response as { message: unknown }).message)
          : 'Não foi possível concluir a autenticação.';
        return this.redirectToAccounts(res, 'error', message);
      }
    }
    return this.redirectToAccounts(res, 'error', 'O callback não recebeu o código de autorização. Tente conectar novamente.');
  }

  private redirectToAccounts(res: Response, status: 'connected' | 'error', message?: string) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:4200').replace(/\/$/, '');
    const params = new URLSearchParams({ bling: status });
    if (message) params.set('message', message);
    return res.redirect(`${frontendUrl}/contas?${params.toString()}`);
  }

  private buildBlingAuthUrl(oauth: ReturnType<typeof getBlingOAuthConfig>,state:string) {
    const params = new URLSearchParams({ client_id: oauth.clientId, redirect_uri: oauth.redirectUri, scope: oauth.scope, response_type: 'code', state });
    return `${oauth.authorizationUrl}?${params.toString()}`;
  }

  private escape(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char] ?? char);
  }
}
