import { Injectable } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay, tap } from 'rxjs';
import { ApiService } from './api.service';

const ROUTE_PERMISSIONS:Record<string,string>={dashboard:'dashboard.view',relatorios:'reports.view',auditoria:'audit.view',pendencias:'pending.view',chat:'chat.view',anuncios:'listings.view',mapa:'map.view',produtos:'map.view','modelos-fiscais':'templates.view',sincronizacoes:'sync.view',contas:'connections.view',configuracoes:'settings.view',usuarios:'ADMIN',historico:'ADMIN'};
@Injectable({providedIn:'root'})
export class AccessService {
  user:any;private request?:Observable<any>;private token='';
  constructor(private api:ApiService){}
  can(permission:string){return this.user?.role==='ADMIN'||!!this.user?.permissions?.includes(permission);}
  load(force=false){const token=localStorage.getItem('token')||'';if(force||!this.request||this.token!==token){this.token=token;this.request=this.api.get<any>('/auth/me').pipe(tap(user=>this.user=user),shareReplay({bufferSize:1,refCount:false}));}return this.request;}
  firstRoute(){return '/'+(Object.keys(ROUTE_PERMISSIONS).find(route=>this.can(ROUTE_PERMISSIONS[route]))||'sem-acesso');}
  routeAllowed(path:string){const key=ROUTE_PERMISSIONS[path];return !key||this.can(key);}
}
export const permissionGuard:CanActivateChildFn=(route)=>{
  const access=inject(AccessService),router=inject(Router);
  return access.load(true).pipe(map(()=>access.routeAllowed(route.routeConfig?.path||'')?true:router.parseUrl(access.firstRoute())),catchError(()=>of(router.parseUrl('/login'))));
};
