import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';

@Component({
  selector: 'app-dashboard', standalone: true, imports: [...UI_IMPORTS, RouterLink],
  template: `
    <header class="page-header dashboard-header">
      <div><span class="eyebrow">VISÃO GERAL</span><h1>Olá, bem-vindo de volta</h1><p class="muted">Acompanhe a saúde do catálogo e encontre o que precisa da sua atenção.</p></div>
      <a mat-flat-button color="primary" appPermission="sync.view" routerLink="/sincronizacoes"><mat-icon>sync</mat-icon>Sincronizar dados</a>
    </header>
    <section class="metric-grid">
      <mat-card><div class="metric-icon products"><mat-icon>inventory_2</mat-icon></div><span>Produtos no catálogo</span><strong>{{ summary?.products ?? 0 }}</strong><small>Produtos base importados</small></mat-card>
      <mat-card><div class="metric-icon variants"><mat-icon>category</mat-icon></div><span>SKUs monitorados</span><strong>{{ summary?.variants ?? 0 }}</strong><small>Variações cadastradas</small></mat-card>
      <mat-card><div class="metric-icon listings"><mat-icon>sell</mat-icon></div><span>Anúncios encontrados</span><strong>{{ summary?.listings ?? 0 }}</strong><small>Em todos os canais</small></mat-card>
      <mat-card [class.has-alert]="(summary?.openIssues ?? 0) > 0"><div class="metric-icon issues"><mat-icon>warning_amber</mat-icon></div><span>Problemas abertos</span><strong>{{ summary?.openIssues ?? 0 }}</strong><small>Itens que pedem revisão</small></mat-card>
    </section>
    <section class="dashboard-grid">
      <article class="attention-card">
        <div class="card-heading"><div><span class="eyebrow">PRÓXIMO PASSO</span><h2>Revise a cobertura dos anúncios</h2></div><span class="large-icon"><mat-icon>fact_check</mat-icon></span></div>
        <p>Identifique rapidamente SKUs sem anúncio, possíveis duplicidades e vínculos que precisam de confirmação.</p>
        <a mat-stroked-button appPermission="audit.view" routerLink="/auditoria">Abrir auditoria <mat-icon>arrow_forward</mat-icon></a>
      </article>
      <article class="quick-card">
        <div class="card-heading"><div><span class="eyebrow">ACESSO RÁPIDO</span><h2>Gerencie sua operação</h2></div></div>
        <nav>
          <a appPermission="map.view" routerLink="/produtos"><span><mat-icon>inventory_2</mat-icon></span><div><strong>Catálogo Bling</strong><small>Consulte produtos e variações</small></div><mat-icon>chevron_right</mat-icon></a>
          <a appPermission="map.view" routerLink="/mapa"><span><mat-icon>account_tree</mat-icon></span><div><strong>Mapa de vínculos</strong><small>Relacione produtos e anúncios</small></div><mat-icon>chevron_right</mat-icon></a>
          <a appPermission="connections.view" routerLink="/contas"><span><mat-icon>link</mat-icon></span><div><strong>Contas conectadas</strong><small>Gerencie suas integrações</small></div><mat-icon>chevron_right</mat-icon></a>
        </nav>
      </article>
    </section>
  `,
  styles: [`
    .eyebrow{display:block;color:#4f46e5;font-size:10px;font-weight:800;letter-spacing:.12em;margin-bottom:8px}.dashboard-header{margin-bottom:26px}.dashboard-header p{font-size:14px}.metric-grid mat-card{position:relative}.metric-grid mat-card>span{display:block;margin-top:16px}.metric-grid mat-card small{display:block;color:#98a2b3;margin-top:8px}.metric-icon{width:40px;height:40px;border-radius:11px;display:grid;place-items:center}.metric-icon.products{color:#4f46e5;background:#eef2ff}.metric-icon.variants{color:#087a55;background:#e7f8f0}.metric-icon.listings{color:#2563eb;background:#e9f0ff}.metric-icon.issues{color:#a15c07;background:#fff3df}.has-alert{border-color:#f2d5a9!important}.dashboard-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:18px;margin-top:18px}.dashboard-grid>article{background:#fff;border:1px solid #e4e7ec;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(16,24,40,.03)}.card-heading{display:flex;justify-content:space-between;gap:16px}.card-heading h2{font-size:21px;margin:0}.attention-card{background:linear-gradient(135deg,#fff 55%,#f0efff)!important}.attention-card p{color:#697386;line-height:1.65;max-width:610px;margin:13px 0 24px}.large-icon{width:54px;height:54px;display:grid;place-items:center;border-radius:15px;background:#4f46e5;color:#fff}.large-icon mat-icon{font-size:28px;width:28px;height:28px}.quick-card nav{display:grid;margin:12px -10px -10px}.quick-card nav a{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:11px 10px;border-radius:11px;color:#344054;text-decoration:none}.quick-card nav a:hover{background:#f7f7fc}.quick-card nav a>span{width:38px;height:38px;border-radius:10px;background:#f1f3f7;display:grid;place-items:center;color:#4f46e5}.quick-card nav a div{display:grid;gap:2px}.quick-card nav a small{color:#697386}.quick-card nav a>mat-icon{color:#98a2b3}@media(max-width:900px){.dashboard-grid{grid-template-columns:1fr}}@media(max-width:560px){.dashboard-header a{width:100%}}
  `]
})
export class DashboardComponent implements OnInit {
  summary: any;
  constructor(private readonly api: ApiService) {}
  ngOnInit() { this.api.get<any>('/dashboard/summary').subscribe((data) => this.summary = data); }
}
