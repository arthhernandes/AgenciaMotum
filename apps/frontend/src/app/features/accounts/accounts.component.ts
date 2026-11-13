import { forkJoin } from 'rxjs';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';
import { AccessService } from '../../core/access.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [...UI_IMPORTS, FormsModule],
  template: `
    <header class="page-header"><h1>Contas</h1><button mat-stroked-button (click)="load()" [disabled]="loading"><mat-icon>refresh</mat-icon>{{ loading ? 'Verificando...' : 'Verificar conexões' }}</button></header>
    <section *ngIf="access.user?.role === 'ADMIN'" class="store-form">
      <h2>Criar loja</h2>
      <mat-form-field appearance="outline"><mat-label>Nome da loja</mat-label><input matInput [(ngModel)]="storeName" maxlength="120" (keyup.enter)="createStore()"></mat-form-field>
      <button mat-flat-button [disabled]="creatingStore || !storeName.trim()" (click)="createStore()">{{creatingStore ? 'Criando...' : 'Criar loja'}}</button>
    </section>
    <p *ngIf="!hasStore">O administrador master precisa criar uma loja para começar.</p>
    <p *ngIf="loading" role="status">Verificando a autorização das contas no Mercado Livre...</p>
    <p *ngIf="disconnectMessage" role="status">{{disconnectMessage}}</p>
    <section class="connection-result" [class.success]="meliResult === 'connected'" [class.failure]="meliResult === 'error'" *ngIf="meliResult" role="status">
      <mat-icon>{{meliResult === 'connected' ? 'check_circle' : 'error'}}</mat-icon>
      <div><strong>{{meliResult === 'connected' ? 'Mercado Livre autorizado com sucesso' : 'Não foi possível autorizar o Mercado Livre'}}</strong><small>{{meliResult === 'connected' ? (renewalUnavailable ? 'A conta está conectada, mas o Mercado Livre não enviou o token de renovação. Confira a permissão offline_access do aplicativo.' : 'A autorização foi salva. O sistema renovará o acesso automaticamente.') : 'Clique em Conectar para tentar novamente com a conta correta do vendedor.'}}</small></div>
    </section>
    <section class="connection-result" [class.success]="blingResult === 'connected'" [class.failure]="blingResult === 'error'" *ngIf="blingResult">
      <mat-icon>{{ blingResult === 'connected' ? 'check_circle' : 'error' }}</mat-icon>
      <div><strong>{{ blingResult === 'connected' ? 'Bling conectada com sucesso' : 'Não foi possível conectar com a Bling' }}</strong><small>{{ blingResult === 'connected' ? 'A autorização foi salva. Você já pode sincronizar os produtos.' : blingMessage }}</small></div>
    </section>
    <table mat-table [dataSource]="accounts" class="data-table">
      <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>Conta</th><td mat-cell *matCellDef="let row"><strong>{{ row.name }}</strong><small>{{ row.nickname }}</small></td></ng-container>
      <ng-container matColumnDef="seller"><th mat-header-cell *matHeaderCellDef>Identificador</th><td mat-cell *matCellDef="let row">{{ row.sellerId || row.clientId || '-' }}</td></ng-container>
      <ng-container matColumnDef="marketplace"><th mat-header-cell *matHeaderCellDef>Integração</th><td mat-cell *matCellDef="let row">{{ row.marketplace || row.source }}</td></ng-container>
      <ng-container matColumnDef="active">
        <th mat-header-cell *matHeaderCellDef>Status</th>
        <td mat-cell *matCellDef="let row">
          <span class="status-chip" [class]="statusClass(row)">{{ statusLabel(row) }}</span>
          <small>{{ statusHint(row) }}</small>
          <small *ngIf="row.connectionCheckedAt">Verificada em {{ row.connectionCheckedAt | date:'dd/MM/yyyy HH:mm:ss' }}</small>
        </td>
      </ng-container>
      <ng-container matColumnDef="actions">
        <th mat-header-cell *matHeaderCellDef></th>
        <td mat-cell *matCellDef="let row">
          <button *ngIf="row.marketplace === 'MERCADO_LIVRE'" type="button" mat-stroked-button matTooltip="Conectar Mercado Livre" appPermission="connections.manage" (click)="connect(row.id)"><mat-icon>link</mat-icon>Conectar</button>
          <button *ngIf="row.marketplace === 'MERCADO_LIVRE'" type="button" mat-stroked-button matTooltip="Sincronizar Mercado Livre" appPermission="sync.manage" (click)="sync(row.id)"><mat-icon>sync</mat-icon>Sincronizar</button>
          <button *ngIf="row.source === 'BLING'" type="button" mat-stroked-button matTooltip="Conectar Bling" appPermission="connections.manage" (click)="connectBling(row)"><mat-icon>link</mat-icon>Conectar</button>
          <button *ngIf="row.source === 'BLING'" type="button" mat-stroked-button matTooltip="Sincronizar Bling" appPermission="sync.manage" (click)="syncBling()"><mat-icon>sync</mat-icon>Sincronizar</button>
          <button *ngIf="row.connected || row.hasCredentials" type="button" mat-stroked-button [disabled]="!!disconnecting" appPermission="connections.manage" (click)="disconnect(row)"><mat-icon>link_off</mat-icon>{{disconnecting===row.id?'Desconectando...':'Desconectar'}}</button>
        </td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns"></tr>
    </table>
  `,
  styles: [`
    .mat-column-actions{white-space:nowrap}.mat-column-actions button{margin:4px}
    .connection-result{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:10px;margin-bottom:16px}.connection-result div{display:grid;gap:3px}.connection-result.success{background:#ecfdf3;color:#067647}.connection-result.failure{background:#fef3f2;color:#b42318}.connection-result small{color:inherit}
  `]
})
export class AccountsComponent implements OnInit {
  accounts: any[] = [];
  loading = false;
  disconnecting:string|null=null;
  disconnectMessage='';
  blingResult: string | null = null;
  meliResult:string|null=null;
  blingMessage = 'Tente autorizar novamente.';
  columns = ['name', 'seller', 'marketplace', 'active', 'actions'];
  storeName = '';
  creatingStore = false;
  get hasStore() { return Boolean(localStorage.getItem('selectedMarketplaceAccountId')); }
  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute, public readonly access: AccessService) {}
  createStore() {
    if (this.creatingStore || !this.storeName.trim()) return;
    this.creatingStore = true;
    this.api.post<{id:string}>('/marketplace-accounts/business', {name:this.storeName.trim()}).subscribe({
      next: store => { localStorage.setItem('selectedMarketplaceAccountId', store.id); window.location.assign('/contas'); },
      error: error => { this.creatingStore = false; this.disconnectMessage = error.error?.message || 'Não foi possível criar a loja.'; }
    });
  }
  renewalUnavailable = false;
  ngOnInit() {
    this.renewalUnavailable = this.route.snapshot.queryParamMap.get('renewal') === 'unavailable';
    const result=this.route.snapshot.queryParamMap.get('meli');this.meliResult=result==='connected'||result==='error'?result:null;
    this.load();
  }
  load() {
    if (!this.hasStore) { this.accounts = []; return; }
    if (this.loading) return;
    this.loading = true;
    const callbackResult = this.route.snapshot.queryParamMap.get('bling');
    this.blingMessage = this.route.snapshot.queryParamMap.get('message') || this.blingMessage;
    forkJoin({
      marketplaces: this.api.get<any[]>('/marketplace-accounts'),
      bling: this.api.get<any>('/bling/account')
    }).subscribe({
      next: ({ marketplaces, bling }) => {
        this.loading = false;
        this.accounts = [...marketplaces, bling];
        this.blingResult = callbackResult === 'error' ? 'error' : callbackResult === 'connected' && bling.connected ? 'connected' : null;
        if (callbackResult === 'connected' && !bling.connected) {
          this.blingResult = 'error';
          this.blingMessage = 'O callback retornou, mas nenhum token válido foi encontrado no banco de dados.';
        }
      },
      error: () => {
        this.loading = false;
        this.blingResult = 'error';
        this.blingMessage = 'Não foi possível validar a conexão. Faça login novamente e tente outra vez.';
      }
    });
  }
  connect(id: string) { this.api.get<any>('/mercadolivre/auth/authorize/'+id,{format:'json'}).subscribe({next:value=>window.location.assign(value.url),error:()=>{this.disconnectMessage='Não foi possível iniciar a conexão. Confira suas permissões e tente novamente.';}}); }
  disconnect(row:any){
    if(this.disconnecting||!window.confirm(`Desconectar ${row.name}? As credenciais salvas serão removidas e será necessário autorizar novamente para usar a integração. Os produtos e o histórico serão mantidos.`))return;
    this.disconnecting=row.id;this.disconnectMessage='';
    this.api.post(`/marketplace-accounts/${row.id}/disconnect`).subscribe({next:()=>{this.disconnecting=null;this.disconnectMessage='Conta desconectada deste sistema. A autorização no provedor pode ser removida nas configurações do Mercado Livre ou da Bling.';this.load();},error:()=>{this.disconnecting=null;this.disconnectMessage='Não foi possível desconectar a conta. Tente novamente.';}});
  }
  connectBling(row?: any) { const account=row?.id; this.api.get<any>('/bling/auth/authorize',{account,format:'json'}).subscribe({next:value=>window.location.assign(value.url),error:()=>this.disconnectMessage='Não foi possível iniciar a conexão. Confira suas permissões e tente novamente.'}); }
  sync(id: string) { this.api.post(`/sync/mercadolivre/${id}`).subscribe(); }
  syncBling() { this.api.post('/sync/bling').subscribe(); }
  statusClass(row: any) {
    if (row.source === 'BLING' && row.connected) return 'attention';
    if (['REAUTH_REQUIRED','ACCESS_DENIED','ACCOUNT_MISMATCH','INACTIVE','CONFIGURATION_ERROR'].includes(row.connectionStatus)) return 'error';
    if (row.connected) return 'ok';
    if (row.configured) return 'attention';
    return 'error';
  }
  statusLabel(row: any) {
    if (row.source === 'BLING' && row.connected) return 'AUTORIZAÇÃO SALVA';
    const labels:Record<string,string>={REAUTH_REQUIRED:'RECONECTAR',ACCESS_DENIED:'ACESSO RECUSADO',ACCOUNT_MISMATCH:'CONTA DIVERGENTE',VERIFICATION_UNAVAILABLE:'NÃO VERIFICADA',CONFIGURATION_ERROR:'REVISAR CONFIGURAÇÃO',INACTIVE:'DESATIVADA',NOT_CONNECTED:'NÃO CONECTADA'};
    if (labels[row.connectionStatus]) return labels[row.connectionStatus];
    if (row.connected) return 'CONECTADA';
    if (row.configured) return 'CONFIGURADA';
    return 'PENDENTE';
  }
  statusHint(row: any) {
    if (row.connectionMessage) return row.connectionMessage;
    if (row.source === 'BLING' && row.connected) return 'Autorização salva; acesso ao serviço ainda não verificado.';
    if (row.connected) return 'Autorização verificada';
    if (row.marketplace === 'MERCADO_LIVRE') return 'Clique em conectar para autorizar';
    if (row.source === 'BLING') return 'Credenciais salvas; clique em conectar para autorizar';
    return '';
  }
}
