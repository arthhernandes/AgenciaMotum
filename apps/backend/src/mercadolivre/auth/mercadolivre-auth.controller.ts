import { Controller, Get, Logger, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { OAuthStateService } from '../../auth/oauth-state.service';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { MercadoLivreAuthService } from './mercadolivre-auth.service';

@ApiTags('mercadolivre-auth')
@Controller('mercadolivre/auth')
export class MercadoLivreAuthController {
  private readonly logger = new Logger(MercadoLivreAuthController.name);
  constructor(private readonly config: ConfigService, private readonly auth: MercadoLivreAuthService, private readonly states:OAuthStateService) {}

  @Get('authorize/:accountId')
  @UseGuards(JwtAuthGuard)
  async authorize(@Param('accountId') accountId: string, @Res() res: Response, @Query('format') format:string|undefined, @Req() req:{user:{id:string}}) {
    const account = await this.auth.accountConfig(accountId);
    const clientId = account.clientId;
    const redirectUri = account.redirectUri;
    const state=await this.states.create('MERCADO_LIVRE',accountId,req.user.id);
    const url = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri ?? '')}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent('offline_access read write')}`;
    return format==='json'?res.json({url}):res.redirect(url);
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') accountId: string, @Query('error') error:string|undefined, @Res() res:Response) {
    const frontend=this.config.get<string>('FRONTEND_URL','').replace(/\/$/,'');
    if(error||!code||!accountId){
      const reason = error && /^[a-z_]{1,60}$/.test(error) ? error : 'invalid_callback';
      this.logger.warn(`OAuth callback rejected reason=${reason}`);
      return res.redirect(`${frontend}/contas?meli=error`);
    }
    try{const authorizedAccount=await this.states.consume('MERCADO_LIVRE',accountId);const result=await this.auth.exchangeCode(authorizedAccount, code);return res.redirect(`${frontend}/contas?meli=connected${result.automaticRenewal===false?'&renewal=unavailable':''}`);}
    catch(error){
      const response = (error as {response?: {status?: number; data?: {error?: unknown}}})?.response;
      const reason = typeof response?.data?.error === 'string' && /^[a-z_]{1,60}$/.test(response.data.error) ? response.data.error : 'exchange_failed';
      this.logger.warn(`OAuth exchange failed status=${response?.status ?? 'unknown'} reason=${reason}`);
      return res.redirect(`${frontend}/contas?meli=error`);
    }
  }
}
