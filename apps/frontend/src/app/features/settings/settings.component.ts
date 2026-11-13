import { Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: UI_IMPORTS,
  template: `
    <header class="page-header">
      <h1>Configurações</h1>
    </header>

    <section class="settings-grid">
      <mat-card>
        <mat-card-header>
          <mat-card-title>Banco e serviços</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="setting-line">
            <span>API</span>
            <span class="status-chip" [class]="health?.api === 'ok' ? 'ok' : 'error'">{{ health?.api || '-' }}</span>
          </div>
          <div class="setting-line">
            <span>PostgreSQL</span>
            <span class="status-chip" [class]="health?.postgres === 'ok' ? 'ok' : 'error'">{{ health?.postgres || '-' }}</span>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card>
        <mat-card-header>
          <mat-card-title>Bling/Tiny</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="setting-line">
            <span>Status</span>
            <span class="status-chip" [class]="bling?.connected ? 'ok' : bling?.configured ? 'attention' : 'error'">
              {{ blingStatus() }}
            </span>
          </div>
          <div class="setting-line">
            <span>Client ID</span>
            <code>{{ bling?.clientId || '-' }}</code>
          </div>
          <div class="setting-block">
            <span>Redirect URI</span>
            <code>{{ bling?.redirectUri || '-' }}</code>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card>
        <mat-card-header>
          <mat-card-title>Mercado Livre</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="setting-line">
            <span>Contas cadastradas</span>
            <strong>{{ marketplaceAccounts.length }}</strong>
          </div>
          <div class="setting-line">
            <span>Contas conectadas</span>
            <strong>{{ connectedMarketplaceAccounts }}</strong>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card>
        <mat-card-header>
          <mat-card-title>Sincronização</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="setting-line">
            <span>Modo atual</span>
            <span class="status-chip attention">MANUAL</span>
          </div>
          <div class="setting-block">
            <span>Automático</span>
            <small>Será ativado depois para rodar ML e Bling em intervalos de 5 minutos.</small>
          </div>
        </mat-card-content>
      </mat-card>
    </section>
  `,
  styles: [`
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }

    .setting-line,
    .setting-block {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 0;
      border-bottom: 1px solid #eceef3;
    }

    .setting-block {
      align-items: flex-start;
      flex-direction: column;
    }

    .setting-line:last-child,
    .setting-block:last-child {
      border-bottom: 0;
    }

    code {
      max-width: 100%;
      overflow-wrap: anywhere;
      color: #2f3a4a;
    }

    small {
      color: #5d6472;
    }
  `]
})
export class SettingsComponent implements OnInit {
  health: any;
  bling: any;
  marketplaceAccounts: any[] = [];

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    forkJoin({
      health: this.api.get<any>('/health'),
      bling: this.api.get<any>('/bling/account'),
      marketplaceAccounts: this.api.get<any[]>('/marketplace-accounts')
    }).subscribe(({ health, bling, marketplaceAccounts }) => {
      this.health = health;
      this.bling = bling;
      this.marketplaceAccounts = marketplaceAccounts;
    });
  }

  get connectedMarketplaceAccounts() {
    return this.marketplaceAccounts.filter((account) => account.accessToken || account.refreshToken).length;
  }

  blingStatus() {
    if (this.bling?.connected) return 'CONECTADA';
    if (this.bling?.configured) return 'CONFIGURADA';
    return 'PENDENTE';
  }
}
