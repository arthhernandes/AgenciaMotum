import { Injectable } from '@nestjs/common';
import { MercadoLivreAuthService } from '../mercadolivre/auth/mercadolivre-auth.service';
import { MercadoLivreClient } from '../mercadolivre/mercadolivre.client';

@Injectable()
export class ConnectionStatusService {
  constructor(private readonly auth:MercadoLivreAuthService,private readonly client:MercadoLivreClient) {}

  async verify(account:{id:string;sellerId:string;active:boolean;accessToken:string|null;refreshToken:string|null}) {
    const result=(status:string,message:string,httpStatus?:number) => ({connected:status==='CONNECTED',connectionStatus:status,connectionMessage:message,connectionCheckedAt:new Date().toISOString(),...(httpStatus ? {connectionHttpStatus:httpStatus} : {})});
    if (!account.active) return result('INACTIVE','Conta desativada no sistema.');
    if (!account.accessToken && !account.refreshToken) return result('NOT_CONNECTED','Conecte a conta para salvar a autorização.');
    try {
      let token=await this.auth.getValidAccessToken(account.id);
      let seller;
      try {seller=await this.client.getAuthenticatedSeller(token);}
      catch (error) {
        if ((error as any)?.response?.status !== 401 || !account.refreshToken) throw error;
        token=await this.auth.getValidAccessToken(account.id,true);
        seller=await this.client.getAuthenticatedSeller(token);
      }
      if (String(seller.id) !== account.sellerId) return result('ACCOUNT_MISMATCH','A autorização pertence a outro vendedor. Reconecte a conta correta.');
      if(!account.refreshToken)return result('CONNECTED','Acesso verificado. O Mercado Livre não enviou token de renovação: confira a permissão offline_access do aplicativo para manter a conexão após o vencimento.');
      return result('CONNECTED','Autorização verificada ao vivo. Permissões de cada operação são verificadas separadamente.');
    } catch (error) {
      const status=(error as any)?.response?.status;
      const code=(error as any)?.response?.data?.error;
      if (['invalid_client','unauthorized_client','invalid_scope','invalid_operator_user_id'].includes(code)) return result('CONFIGURATION_ERROR','O Mercado Livre recusou a configuração do aplicativo ou do tipo de usuário. Confira as credenciais e permissões do aplicativo antes de reconectar.',status);
      if(status===401&&!account.refreshToken)return result('REAUTH_REQUIRED','Esta autorização está sem token de renovação. Habilite Acesso offline (offline_access) nas permissões do aplicativo no DevCenter e depois reconecte a conta. Reconectar sem essa permissão mantém o acesso temporário.',status);
      if (status===401 || (status===400 && code==='invalid_grant')) return result('REAUTH_REQUIRED','A autorização foi recusada e não pôde ser renovada. Reconecte a conta.',status);
      if (status===403) return result('ACCESS_DENIED','O Mercado Livre recusou a verificação de acesso (403). Confira as permissões ou políticas de acesso; isso não comprova que o token expirou.',status);
      return result('VERIFICATION_UNAVAILABLE','Não foi possível verificar a conexão agora. As credenciais foram preservadas; tente verificar novamente.',status);
    }
  }
}
