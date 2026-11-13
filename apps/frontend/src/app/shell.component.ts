import { AccessService } from './core/access.service';
import { PermissionDirective } from './core/permission.directive';
import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { catchError, exhaustMap, forkJoin, of, Subject, takeUntil, timer } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSelectModule } from '@angular/material/select';
import { ApiService, AuthService } from './core/api.service';

@Component({
  selector: 'app-shell', standalone: true,
  imports: [PermissionDirective,CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive, MatButtonModule, MatIconModule, MatSelectModule, MatSidenavModule, MatToolbarModule],
  template: `
    <mat-sidenav-container class="layout">
      <mat-sidenav #nav [mode]="isMobile ? 'over' : 'side'" [opened]="!isMobile" class="sidebar">
        <div class="brand"><span class="consultor-emblem"><img src="/assets/branding/o-consultor-emblem.png" alt="" /></span><span>O Consultor<small>Bling & marketplaces</small></span></div>
        <div class="nav-label">VISÃO GERAL</div>
        <a mat-button appPermission="dashboard.view" routerLink="/dashboard" routerLinkActive="active" (click)="closeOnMobile(nav)"><mat-icon>space_dashboard</mat-icon><span>Resumo<small>Indicadores principais</small></span></a>
        <div class="nav-label">DADOS</div>
        <a mat-button appPermission="reports.view" routerLink="/relatorios" routerLinkActive="active" (click)="closeOnMobile(nav)"><mat-icon>assessment</mat-icon><span>Relatórios<small>Desempenho dos anúncios</small></span></a>
        <a mat-button appPermission="chat.view" routerLink="/chat" routerLinkActive="active" (click)="closeOnMobile(nav)"><mat-icon>auto_awesome</mat-icon><span>Assistente IA<small>Conversar e executar ações</small></span></a>
        <a mat-button appPermission="listings.view" routerLink="/anuncios" routerLinkActive="active" (click)="closeOnMobile(nav)"><mat-icon>sell</mat-icon><span>Anúncios<small>Publicações importadas</small></span></a>
        <a mat-button appPermission="map.view" routerLink="/mapa" routerLinkActive="active" (click)="closeOnMobile(nav)"><mat-icon>account_tree</mat-icon><span>Mapa de vínculos<small>Produtos × anúncios</small></span></a>
        <a mat-button appPermission="templates.view" routerLink="/modelos-fiscais" routerLinkActive="active" (click)="closeOnMobile(nav)"><mat-icon>receipt_long</mat-icon><span>Modelos fiscais<small>Dados para reutilizar</small></span></a>
        <div class="nav-label">INTEGRAÇÕES</div>
        <a mat-button appPermission="sync.view" routerLink="/sincronizacoes" routerLinkActive="active" (click)="closeOnMobile(nav)"><mat-icon>sync</mat-icon><span>Sincronizações<small>Importar e acompanhar</small></span></a>
        <a *ngIf="isAdmin" mat-button routerLink="/usuarios" routerLinkActive="active" (click)="closeOnMobile(nav)"><mat-icon>manage_accounts</mat-icon><span>Usuários<small>Gerenciar acessos</small></span></a>
        <a *ngIf="isAdmin" mat-button routerLink="/historico" routerLinkActive="active" (click)="closeOnMobile(nav)"><mat-icon>history</mat-icon><span>Histórico de atividades<small>Ações dos usuários</small></span></a>
        <a mat-button appPermission="settings.view" routerLink="/configuracoes" routerLinkActive="active" (click)="closeOnMobile(nav)"><mat-icon>settings</mat-icon><span>Configurações<small>Diagnóstico do sistema</small></span></a>
      </mat-sidenav>
      <mat-sidenav-content>
        <mat-toolbar class="topbar">
          <div class="topbar-start"><button class="menu-trigger" mat-icon-button aria-label="Abrir menu" (click)="nav.toggle()"><mat-icon>menu</mat-icon></button><span class="consultor-emblem topbar-emblem"><img src="/assets/branding/o-consultor-emblem.png" alt="" /></span><span class="topbar-title"><strong>O Consultor</strong><small>Visão integrada da sua operação</small></span></div>
          <div class="topbar-actions">
            <div class="account-switcher" *ngIf="accounts.length"><mat-icon>storefront</mat-icon><span><small>CONTA ATUAL</small><mat-select [(ngModel)]="selectedAccountId" (selectionChange)="changeAccount($event.value)" aria-label="Selecionar conta"><mat-option *ngFor="let account of accounts" [value]="account.id">{{ account.displayName }}</mat-option></mat-select></span></div>
            <button mat-icon-button aria-label="Sair" title="Sair" (click)="logout()"><mat-icon>logout</mat-icon></button>
          </div>
        </mat-toolbar>
        <aside class="connection-warning" role="status" *ngIf="connectionWarnings.length"><mat-icon>link_off</mat-icon><div><strong>A conexão precisa de atenção</strong><p *ngFor="let warning of connectionWarnings">{{warning}}</p></div><a mat-stroked-button appPermission="connections.view" routerLink="/contas">Ver contas</a></aside>
        <main class="content"><router-outlet /></main>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles:[`.connection-warning{display:flex;align-items:center;gap:14px;margin:16px 24px 0;padding:14px 18px;background:#fff8e6;color:#795c14;border-radius:12px;flex-wrap:wrap}.connection-warning div{flex:1;min-width:180px}.connection-warning p{margin:4px 0;font-size:13px}.connection-warning a{white-space:nowrap}`]
})
export class ShellComponent implements OnInit, OnDestroy {
  isAdmin=false;
  connectionWarnings:string[]=[];
  private readonly destroyed=new Subject<void>();
  isMobile = window.innerWidth <= 800;
  accounts: Array<{id:string;displayName:string}> = [];
  selectedAccountId = localStorage.getItem('selectedMarketplaceAccountId') ?? '';
  constructor(public readonly access:AccessService,private readonly api: ApiService, private readonly auth: AuthService, private readonly router: Router) {}
  ngOnInit(){this.access.load().pipe(takeUntil(this.destroyed)).subscribe({next:user=>this.isAdmin=user.role==='ADMIN'});this.api.get<Array<{id:string;displayName:string}>>('/marketplace-accounts/business').subscribe((accounts)=>{this.accounts=this.orderAccounts(accounts);if(!accounts.length){localStorage.removeItem('selectedMarketplaceAccountId');this.selectedAccountId='';if(this.access.user?.role==='ADMIN')void this.router.navigateByUrl('/contas');return;}if(!this.selectedAccountId&&this.accounts.length){localStorage.setItem('selectedMarketplaceAccountId',this.accounts[0].id);window.location.reload()}else if(this.selectedAccountId&&!this.accounts.some((account)=>account.id===this.selectedAccountId)&&this.accounts.length){localStorage.setItem('selectedMarketplaceAccountId',this.accounts[0].id);window.location.reload()}else this.watchConnections();})}
  private watchConnections(){
    if(!this.selectedAccountId)return;
    if(!['connections.view','settings.view','sync.view'].some(key=>this.access.can(key)))return;
    timer(0,300000).pipe(exhaustMap(()=>forkJoin({marketplaces:this.api.get<any[]>('/marketplace-accounts'),bling:this.api.get<any>('/bling/account')}).pipe(catchError(()=>of(null)))),takeUntil(this.destroyed)).subscribe(result=>{
      if(!result)return;
      this.connectionWarnings=[...result.marketplaces,result.bling].filter(account=>['REAUTH_REQUIRED','ACCOUNT_MISMATCH','NOT_CONNECTED','CONFIGURED_NOT_CONNECTED'].includes(account.connectionStatus)).map(account=>`${account.name}: ${account.connectionStatus==='ACCOUNT_MISMATCH'?'autorize com a conta correta do vendedor.':'autorize a integração na tela Contas para continuar.'}`);
    });
  }
  ngOnDestroy(){this.destroyed.next();this.destroyed.complete();}
  @HostListener('window:resize') onResize() { this.isMobile = window.innerWidth <= 800; }
  closeOnMobile(nav: { close: () => void }) { if (this.isMobile) nav.close(); }
  changeAccount(accountId:string){if(!accountId||accountId===localStorage.getItem('selectedMarketplaceAccountId'))return;localStorage.setItem('selectedMarketplaceAccountId',accountId);window.location.reload()}
  private orderAccounts(accounts:Array<{id:string;displayName:string}>){return [...accounts].sort((left,right)=>left.displayName.localeCompare(right.displayName))}
  logout() { this.auth.logout(); void this.router.navigateByUrl('/login'); }
}
