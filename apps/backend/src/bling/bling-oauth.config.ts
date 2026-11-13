import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export function getBlingOAuthConfig(config: ConfigService, requestedAccount?: string) {
  if (!requestedAccount) throw new BadRequestException('Selecione uma loja antes de conectar o Bling.');
  const clientId = config.get<string>('BLING_CLIENT_ID', '');
  const clientSecret = config.get<string>('BLING_CLIENT_SECRET', '');
  const redirectUri = config.get<string>('BLING_REDIRECT_URI', '');
  if (!clientId || !clientSecret || !redirectUri) throw new BadRequestException('Configure BLING_CLIENT_ID, BLING_CLIENT_SECRET e BLING_REDIRECT_URI no servidor.');
  return { account: requestedAccount, accountName: requestedAccount, clientId, clientSecret, redirectUri,
    authorizationUrl: 'https://www.bling.com.br/Api/v3/oauth/authorize',
    tokenUrl: 'https://api.bling.com.br/Api/v3/oauth/token', scope: '' };
}
