import { AccessService } from '../../core/access.service';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { EMPTY, Subject, catchError, combineLatest, debounceTime, finalize, startWith, switchMap, tap, takeUntil } from 'rxjs';
import { PageEvent } from '@angular/material/paginator';
import { ApiService, Page } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';
import { LinkedAnnouncementsComponent } from './linked-announcements.component';
import { compareSizes } from '../listings/size-order';
import { countAnnouncements } from './announcement-key';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [...UI_IMPORTS, LinkedAnnouncementsComponent],
  template: `
    <header class="page-header">
      <div><h1>Mapa de Anúncios</h1><p>{{ total }} produtos base encontrados · {{ products.length }} nesta página</p></div>
      <mat-form-field appearance="outline" class="search"><mat-label>Buscar SKU, nome, MLB ou User Product ID</mat-label><input matInput [formControl]="search"></mat-form-field>
    </header>
    <section class="filter-row">
      <mat-form-field appearance="outline"><mat-label>Vinculo manual</mat-label><mat-select [formControl]="hasListing"><mat-option value="">Todos</mat-option><mat-option value="true">Vinculados</mat-option><mat-option value="false">Pendentes</mat-option></mat-select></mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Status ML</mat-label><mat-select [formControl]="listingStatus"><mat-option value="">Todos</mat-option><mat-option value="active">Ativo</mat-option><mat-option value="paused">Pausado</mat-option><mat-option value="closed">Encerrado</mat-option></mat-select></mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Problemas</mat-label><mat-select [formControl]="hasIssues"><mat-option value="">Todos</mat-option><mat-option value="true">Com problemas</mat-option></mat-select></mat-form-field>
    </section>
    <mat-progress-bar *ngIf="loading" mode="indeterminate" />
    <div class="list-scroll">
    <table mat-table [dataSource]="products" multiTemplateDataRows class="data-table map-table">
      <ng-container matColumnDef="product"><th mat-header-cell *matHeaderCellDef>Produto</th><td mat-cell *matCellDef="let row"><strong>{{ row.title }}</strong><small>{{ row.brand }}</small></td></ng-container>
      <ng-container matColumnDef="sku"><th mat-header-cell *matHeaderCellDef>SKU base</th><td mat-cell *matCellDef="let row"><strong>{{ row.sku }}</strong></td></ng-container>
      <ng-container matColumnDef="stock"><th mat-header-cell *matHeaderCellDef>Estoque Bling</th><td mat-cell *matCellDef="let row">{{ stock(row) }}</td></ng-container>
      <ng-container matColumnDef="variants"><th mat-header-cell *matHeaderCellDef>Variações</th><td mat-cell *matCellDef="let row">{{ row.variants?.length || 0 }}</td></ng-container>
      <ng-container matColumnDef="listings"><th mat-header-cell *matHeaderCellDef [attr.aria-sort]="announcementSort ? (announcementSort==='desc'?'descending':'ascending') : 'none'"><button class="sort-column" (click)="sortAnnouncements()" [attr.aria-label]="announcementSort==='desc'?'Ordenar anúncios vinculados do menor para o maior':'Ordenar anúncios vinculados do maior para o menor'">Anúncios vinculados<mat-icon>{{announcementSort==='desc'?'arrow_downward':announcementSort==='asc'?'arrow_upward':'unfold_more'}}</mat-icon></button></th><td mat-cell *matCellDef="let row"><button mat-stroked-button class="open-button" (click)="$event.stopPropagation(); toggle(row)"><mat-icon>{{ selected?.id === row.id ? 'expand_less' : 'expand_more' }}</mat-icon>{{ announcementCount(row) }} anúncios</button></td></ng-container>
      <ng-container matColumnDef="issues"><th mat-header-cell *matHeaderCellDef>Problemas</th><td mat-cell *matCellDef="let row">{{ row.issues?.length || 0 }}</td></ng-container>
      <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>Status</th><td mat-cell *matCellDef="let row"><span class="status-chip" [class]="row.issues?.length ? 'attention' : announcementCount(row) ? 'ok' : 'review'">{{ row.issues?.length ? 'REVISAR' : announcementCount(row) ? 'VINCULADO' : 'SEM ANÚNCIO' }}</span></td></ng-container>
      <ng-container matColumnDef="expandedDetail"><td mat-cell *matCellDef="let row" [attr.colspan]="columns.length"><div class="link-panel" *ngIf="selected?.id === row.id"><header><div><span class="muted">MAPA DO PRODUTO</span><h2>{{ row.sku }} · {{ row.title }}</h2></div><button mat-icon-button (click)="selected=null"><mat-icon>close</mat-icon></button></header><div class="cost-toolbar" *ngIf="access.can('costs.view')"><div><strong>Custos cadastrados na Bling</strong><small>Valores da conta selecionada, por SKU. Preço de venda não é utilizado como custo.</small></div><button mat-stroked-button (click)="loadCosts(row,true)" [disabled]="costLoading.has(row.id)"><mat-icon>refresh</mat-icon>{{costLoading.has(row.id) ? 'Consultando custos...' : 'Atualizar custos Bling'}}</button></div><mat-progress-bar *ngIf="costLoading.has(row.id)" mode="indeterminate"></mat-progress-bar><p *ngIf="costErrors.get(row.id)" role="alert" class="cost-error">{{costErrors.get(row.id)}}</p><div class="base-links" *ngIf="announcementCount(row)"><h3>Anúncios Mercado Livre vinculados</h3><app-linked-announcements [links]="allLinks(row)"></app-linked-announcements></div><div class="color-groups"><section class="color-group" *ngFor="let group of groupVariants(row.variants)"><div class="color-heading"><span class="color-dot"></span><div><h3>{{ group.color }}</h3><small>{{ group.variants.length }} {{ group.variants.length === 1 ? 'tamanho' : 'tamanhos' }}</small></div></div><div class="size-grid"><article class="variant-map" *ngFor="let variant of group.variants"><div class="variant-heading"><div><strong>{{ variant.size || 'Sem tamanho' }}</strong><small>SKU {{ variant.sku }} · Estoque {{ variant.stock }}</small><ng-container *ngIf="access.can('costs.view')"><span class="variant-cost" *ngIf="costFor(row,variant) as price;else pendingCost">Custo Bling: <strong>{{price.cost != null ? (price.cost | currency:'BRL') : 'Não informado'}}</strong><small *ngIf="price.checkedAt">Consultado em {{price.checkedAt | date:'dd/MM/yy HH:mm'}}</small><small class="cost-error" *ngIf="price.message">{{price.message}}</small></span><ng-template #pendingCost><span class="variant-cost">{{costLoading.has(row.id) ? 'Consultando custo Bling...' : 'Custo Bling ainda não consultado'}}</span></ng-template></ng-container></div><span class="status-chip" [class]="variant.links?.length ? 'ok' : 'review'">{{ variant.links?.length ? variantAnnouncementCount(variant) + ' ANÚNCIO(S)' : 'SEM ANÚNCIO' }}</span></div></article></div></section></div><p class="muted empty-links" *ngIf="!row.variants?.length && !row.links?.length">Nenhum anúncio vinculado a este produto.</p></div></td></ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns" class="product-row" [class.expanded]="selected?.id === row.id" (click)="toggle(row)"></tr>
      <tr mat-row *matRowDef="let row; columns: ['expandedDetail']" class="detail-row"></tr>
    </table>
    </div>
    <p *ngIf="loadError" role="alert">{{ loadError }}</p>
    <mat-paginator [length]="total" [pageIndex]="pageIndex" [pageSize]="pageSize" [pageSizeOptions]="[25, 50, 100, 200]" (page)="changePage($event)" showFirstLastButtons aria-label="Páginas do mapa de vínculos"></mat-paginator>
  `,
  styles: [`.sort-column{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:6px 0;color:inherit;font:inherit;font-weight:inherit;text-transform:inherit;cursor:pointer;white-space:nowrap}.sort-column mat-icon{width:16px;height:16px;font-size:16px;color:#0d5275}.sort-column:focus-visible{outline:2px solid #0d5275;outline-offset:3px;border-radius:3px}
    .cost-toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin:0 0 16px;padding:14px;background:#eef6fb;border:1px solid #d9e7f0;border-radius:10px}.cost-toolbar>div{display:grid;gap:5px}.cost-toolbar small{color:#667085;font-size:12px}.variant-cost{display:block;margin-top:7px;color:#0b5277;font-size:12px}.variant-cost small{display:block;margin-top:4px;font-size:10px}.cost-error{color:#a66b00!important;font-size:12px}.map-table{min-width:900px}.open-button{white-space:nowrap}.product-row{cursor:pointer}.product-row:hover,.product-row.expanded{background:#f5f8ff}.detail-row{height:0}.detail-row td{padding:0!important;border:0}.link-panel{padding:20px 24px;background:#f8faff;border-top:1px solid #d6e4ff;border-bottom:1px solid #d6e4ff}.link-panel>header{display:flex;justify-content:space-between;align-items:flex-start}.link-panel h2{font-size:19px;margin:4px 0 18px}.link-panel h3{font-size:15px;margin:0}.base-links{margin-bottom:14px}.color-groups{display:grid;gap:16px}.color-group{background:#fff;border:1px solid #d6e4ff;border-radius:12px;padding:14px}.color-heading{display:flex;align-items:center;gap:10px;margin-bottom:12px}.color-heading>div{display:grid;gap:2px}.color-heading small{color:#667085}.color-dot{width:12px;height:12px;border-radius:50%;background:#155eef;box-shadow:0 0 0 4px #eaf0ff}.size-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:9px}.variant-map{background:#f9fafb;border:1px solid #eaecf0;border-radius:10px;padding:12px}.variant-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.variant-heading>div{display:grid;gap:3px}.variant-heading small{color:#667085}.ads-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px;margin-top:12px}.ad-card{border:1px solid #eaecf0;border-radius:9px;padding:11px 12px;background:#fff;display:grid;gap:9px}.ad-card>div:first-child{display:grid;gap:3px}.ad-card small{color:#667085}.ad-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}.ad-meta a{color:#155eef}.empty-links{text-align:center;padding:18px}@media(max-width:900px){.map-table{display:block;overflow:auto}.variant-heading{align-items:flex-start;flex-direction:column}.size-grid{grid-template-columns:1fr}}
  `]
})
export class MapComponent implements OnInit,OnDestroy {
  readonly costLoading=new Set<string>();readonly costErrors=new Map<string,string>();
  private readonly costs=new Map<string,Map<string,any>>();private readonly destroyed=new Subject<void>();
  private readonly accountId=localStorage.getItem('selectedMarketplaceAccountId');
  costFor(row:any,variant:any){return this.costs.get(row.id)?.get(variant.sku);}
  loadCosts(row:any,refresh=false){
    if(!this.access.can('costs.view')||this.costLoading.has(row.id)||this.accountId!==localStorage.getItem('selectedMarketplaceAccountId'))return;
    this.costLoading.add(row.id);this.costErrors.delete(row.id);
    this.api.post<any>('/products/'+row.id+'/costs',{refresh}).pipe(takeUntil(this.destroyed),finalize(()=>this.costLoading.delete(row.id))).subscribe({next:value=>{this.costs.set(row.id,new Map(value.rows.map((entry:any)=>[entry.sku,entry])));if(value.rows.some((entry:any)=>entry.stale))this.costErrors.set(row.id,'Alguns custos não puderam ser atualizados. Confira os avisos por SKU.');},error:error=>this.costErrors.set(row.id,typeof error.error?.message==='string'?error.error.message:'Não foi possível consultar os custos na Bling.')});
  }
  ngOnDestroy(){this.destroyed.next();this.destroyed.complete();}
  search = new FormControl('');
  hasListing = new FormControl('');
  listingStatus = new FormControl('');
  hasIssues = new FormControl('');
  products: any[] = [];
  selected: any | null = null;
  columns: string[] = ['product', 'sku', 'stock', 'variants', 'listings', 'issues', 'status'];
  loading = false;
  total = 0;
  pageIndex = 0;
  pageSize = 50;
  announcementSort: 'asc'|'desc'|undefined;
  sortAnnouncements(){this.announcementSort=this.announcementSort==='desc'?'asc':'desc';this.pageIndex=0;this.selected=null;this.refresh.next();}
  loadError = '';
  private readonly refresh = new Subject<void>();
  changePage(event: PageEvent) { this.pageIndex = event.pageIndex; this.pageSize = event.pageSize; this.selected = null; this.refresh.next(); }

  constructor(public readonly access:AccessService,private readonly api: ApiService) {}

  ngOnInit() {
    combineLatest([
      this.search.valueChanges.pipe(startWith(''), tap(() => this.pageIndex = 0)),
      this.hasListing.valueChanges.pipe(startWith(''), tap(() => this.pageIndex = 0)),
      this.listingStatus.valueChanges.pipe(startWith(''), tap(() => this.pageIndex = 0)),
      this.hasIssues.valueChanges.pipe(startWith(''), tap(() => this.pageIndex = 0)),
      this.refresh.pipe(startWith(undefined))
    ]).pipe(debounceTime(350), switchMap(([search, hasListing, listingStatus, hasIssues]) => {
      this.loading = true;
      return this.api.get<Page<any>>('/products', {
        search: search ?? '',
        hasListing: hasListing ?? '',
        listingStatus: listingStatus ?? '',
        hasIssues: hasIssues ?? '',
        page: this.pageIndex + 1,
        sortBy:this.announcementSort?'listings':undefined,
        sortDirection:this.announcementSort,
        limit: this.pageSize
      }).pipe(catchError(() => { this.loadError = 'Não foi possível carregar o mapa. Tente novamente.'; return EMPTY; }), finalize(() => this.loading = false));
    }),takeUntil(this.destroyed)).subscribe((page) => {
      this.products = page.data;
      this.total = page.pagination.total;
      this.loadError = '';
      if (this.selected) this.selected = this.products.find((row) => row.id === this.selected.id) ?? null;
      this.loading = false;
    });
  }

  stock(row: any) {
    if ((row.variants ?? []).some((variant: any) => variant.stock == null)) return 'Estoque incompleto';
    return (row.variants ?? []).reduce((total: number, variant: any) => total + variant.stock, 0);
  }

  toggle(row: any) { this.selected = this.selected?.id === row.id ? null : row;if(this.selected)this.loadCosts(row); }

  groupVariants(variants: any[]) {
    const groups = new Map<string, any[]>();
    for (const variant of variants ?? []) {
      const color = (variant.color || 'Sem cor informada').trim();
      groups.set(color, [...(groups.get(color) ?? []), variant]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([color, items]) => ({
      color,
      variants: items.sort((a, b) => compareSizes(a.size || '', b.size || ''))
    }));
  }

  allLinks(row: any) {
    const links = [...(row.links ?? []), ...(row.variants ?? []).flatMap((variant: any) => variant.links ?? [])];
    return [...new Map(links.map((link: any) => [link.id, { ...link, productVariant: link.productVariant || row.variants?.find((variant: any) => variant.id === link.productVariantId) }])).values()];
  }

  announcementCount(row: any) { return countAnnouncements(this.allLinks(row)); }
  variantAnnouncementCount(variant: any) { return countAnnouncements(variant.links); }

  statusClass(status: string) {
    if (status === 'active') return 'ok';
    if (status === 'paused') return 'attention';
    return 'error';
  }
}
