import { BadRequestException, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { assertPermissions, assertRoutePermissions } from './permissions';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context:ExecutionContext){
    const authenticated=await super.canActivate(context);if(!authenticated)return false;
    const request=context.switchToHttp().getRequest();
    assertRoutePermissions(request.user,request.method,request.path);
    const path = request.path.replace(/^\/api(?=\/)/, '');
    if (/^\/(dashboard|products|product-variants|listings|listing-links|audit|operations|reports|chat)(\/|$)/.test(path)
      && !request.query?.marketplaceAccountId && !request.body?.marketplaceAccountId) {
      throw new BadRequestException('Selecione uma loja para continuar.');
    }
    if(request.method!=='GET'&&request.path.startsWith('/api/chat/')&&request.body?.conversationId)assertPermissions(request.user,'chat.manage');
    return true;
  }
}
