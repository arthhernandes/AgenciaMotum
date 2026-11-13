import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormControl } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { combineLatest, debounceTime, startWith, switchMap } from 'rxjs';
import { ApiService, Page } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';

interface Channel { marketplace: string; conta: string; quantidade: number; anuncios: Array<{ id: string; status: string }>; }
interface AdsAuditRow { skuBase: string; produto: string; quantidadeVariacoes: number; totalAnuncios: number; status: 'SEM_ANUNCIO' | 'OK' | 'POSSIVEL_DUPLICIDADE'; variacoes: string[]; canais: Channel[]; }
interface AdsAuditResponse extends Page<AdsAuditRow> { resumo: { totalSkusBase: number; skusComAnuncio: number; skusSemAnuncio: number; skusComPossivelDuplicidade: number; coberturaPercentual: number }; }

@Component({
  selector: 'app-audit', standalone: true, imports: UI_IMPORTS,
  template: `
    <header class="page-header"><div><h1>Auditoria de Anúncios</h1><p class="muted">Contagem de anúncios únicos agrupada pelo SKU base</p></div></header>
    <section class="metric-grid audit-metrics">
      <mat-card><span>Total de SKUs</span><strong>{{ summary.totalSkusBase }}</strong></mat-card>
      <mat-card><span>Com anúncio</span><strong>{{ summary.skusComAnuncio }}</strong></mat-card>
      <mat-card><span>Sem anúncio</span><strong>{{ summary.skusSemAnuncio }}</strong></mat-card>
      <mat-card><span>Possível duplicidade</span><strong>{{ summary.skusComPossivelDuplicidade }}</strong></mat-card>
      <mat-card><span>Cobertura</span><strong>{{ summary.coberturaPercentual | number:'1.2-2' }}%</strong></mat-card>
    </section>
    <section class="filter-row audit-filters">
      <mat-form-field appearance="outline"><mat-label>Busca</mat-label><input matInput [formControl]="search" placeholder="SKU ou produto"></mat-form-field>
      <mat-form-field appearance="outline"><mat-label>SKU base</mat-label><input matInput [formControl]="skuBase"></mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Marketplace</mat-label><input matInput [formControl]="marketplace"></mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Conta</mat-label><input matInput [formControl]="conta"></mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Status</mat-label><mat-select [formControl]="status"><mat-option value="">Todos</mat-option><mat-option value="OK">OK</mat-option><mat-option value="SEM_ANUNCIO">Sem anúncio</mat-option><mat-option value="POSSIVEL_DUPLICIDADE">Possível duplicidade</mat-option></mat-select></mat-form-field>
    </section>
    <div class="quick-filters">
      <button mat-stroked-button [class.active-filter]="status.value === 'SEM_ANUNCIO'" (click)="toggleStatus('SEM_ANUNCIO')">Somente sem anúncio</button>
      <button mat-stroked-button [class.active-filter]="status.value === 'POSSIVEL_DUPLICIDADE'" (click)="toggleStatus('POSSIVEL_DUPLICIDADE')">Somente possíveis duplicidades</button>
    </div>
    <div class="list-scroll" #listScroll>
    <table mat-table [dataSource]="rows" class="data-table audit-table">
      <ng-container matColumnDef="sku"><th mat-header-cell *matHeaderCellDef>SKU Base</th><td mat-cell *matCellDef="let row"><button mat-button class="sku-link" (click)="selected = selected === row ? null : row">{{ row.skuBase }}</button></td></ng-container>
      <ng-container matColumnDef="product"><th mat-header-cell *matHeaderCellDef>Produto</th><td mat-cell *matCellDef="let row">{{ row.produto }}</td></ng-container>
      <ng-container matColumnDef="variants"><th mat-header-cell *matHeaderCellDef>Variações</th><td mat-cell *matCellDef="let row">{{ row.quantidadeVariacoes }}</td></ng-container>
      <ng-container matColumnDef="mercadolivre"><th mat-header-cell *matHeaderCellDef>Mercado Livre</th><td mat-cell *matCellDef="let row">{{ channelCount(row, 'MERCADO_LIVRE') }}</td></ng-container>
      <ng-container matColumnDef="shopee"><th mat-header-cell *matHeaderCellDef>Shopee</th><td mat-cell *matCellDef="let row">{{ channelCount(row, 'SHOPEE') }}</td></ng-container>
      <ng-container matColumnDef="others"><th mat-header-cell *matHeaderCellDef>Outros</th><td mat-cell *matCellDef="let row">{{ otherCount(row) }}</td></ng-container>
      <ng-container matColumnDef="total"><th mat-header-cell *matHeaderCellDef>Total de Anúncios</th><td mat-cell *matCellDef="let row"><strong>{{ row.totalAnuncios }}</strong></td></ng-container>
      <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>Status</th><td mat-cell *matCellDef="let row"><span class="status-chip" [class]="statusClass(row.status)">{{ statusLabel(row.status) }}</span></td></ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns"></tr>
    </table>
    <mat-card class="audit-detail" *ngIf="selected">
      <header><div><h2>SKU BASE: {{ selected.skuBase }}</h2><p>{{ selected.produto }}</p></div><button mat-icon-button (click)="selected = null"><mat-icon>close</mat-icon></button></header>
      <div class="channel-grid" *ngIf="selected.canais.length; else noAds"><section *ngFor="let channel of selected.canais"><h3>{{ marketplaceLabel(channel.marketplace) }}</h3><strong>{{ channel.conta }}</strong><p *ngFor="let ad of channel.anuncios"><span>{{ ad.id }}</span><span class="status-chip review">{{ ad.status }}</span></p></section></div>
      <ng-template #noAds><p class="muted">Nenhum anúncio vinculado a este SKU base.</p></ng-template>
      <h3>Variações ({{ selected.variacoes.length }})</h3><div class="variant-list"><span *ngFor="let sku of selected.variacoes">{{ sku }}</span></div>
    </mat-card>
    </div>
    <mat-paginator [length]="pagination.total" [pageIndex]="pagination.page - 1" [pageSize]="pagination.limit" [pageSizeOptions]="[25, 50, 100, 200]" (page)="changePage($event)"></mat-paginator>
  `,
  styles: [`
    .page-header p{margin:5px 0 0}.audit-metrics{grid-template-columns:repeat(5,minmax(140px,1fr));margin-bottom:20px}.audit-filters{flex-wrap:wrap}.audit-filters mat-form-field{flex:1 1 180px}.quick-filters{display:flex;gap:10px;margin:-4px 0 16px}.active-filter{background:#eaf2ff;color:#1657a7}.audit-table{min-width:1050px}.sku-link{padding:0;min-width:0;font-weight:700}.audit-detail{margin-top:18px;padding:20px}.audit-detail header{display:flex;justify-content:space-between}.audit-detail h2{margin:0;font-size:20px}.audit-detail header p{margin:5px 0 18px}.channel-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.channel-grid section{border:1px solid #d9dde5;border-radius:8px;padding:14px}.channel-grid h3{margin:0 0 4px}.channel-grid p{display:flex;align-items:center;justify-content:space-between;margin:10px 0 0}.variant-list{display:flex;flex-wrap:wrap;gap:8px}.variant-list span{background:#eef2f7;border-radius:5px;padding:5px 8px}@media(max-width:1000px){.audit-metrics{grid-template-columns:repeat(2,1fr)}.data-table{display:block;overflow:auto}}
  `]
})
export class AuditComponent implements OnInit {
  @ViewChild('listScroll') private listScroll?: ElementRef<HTMLElement>;
  search=new FormControl(''); skuBase=new FormControl(''); marketplace=new FormControl(''); conta=new FormControl(''); status=new FormControl('');
  rows:AdsAuditRow[]=[]; selected:AdsAuditRow|null=null;
  summary={totalSkusBase:0,skusComAnuncio:0,skusSemAnuncio:0,skusComPossivelDuplicidade:0,coberturaPercentual:0};
  pagination={page:1,limit:50,total:0,pages:1}; columns=['sku','product','variants','mercadolivre','shopee','others','total','status'];
  constructor(private readonly api:ApiService){}
  ngOnInit(){ combineLatest([this.search.valueChanges.pipe(startWith('')),this.skuBase.valueChanges.pipe(startWith('')),this.marketplace.valueChanges.pipe(startWith('')),this.conta.valueChanges.pipe(startWith('')),this.status.valueChanges.pipe(startWith(''))]).pipe(debounceTime(300),switchMap(()=>{this.pagination.page=1;return this.fetch()})).subscribe((response)=>this.apply(response)); }
  fetch(){return this.api.get<AdsAuditResponse>('/audit/ads',{search:this.search.value??'',skuBase:this.skuBase.value??'',marketplace:this.marketplace.value??'',conta:this.conta.value??'',status:this.status.value??'',page:this.pagination.page,limit:this.pagination.limit})}
  apply(response:AdsAuditResponse){this.rows=response.data;this.summary=response.resumo;this.pagination=response.pagination;this.selected=null}
  changePage(event:PageEvent){this.pagination.page=event.pageIndex+1;this.pagination.limit=event.pageSize;this.fetch().subscribe((response)=>{this.apply(response);this.scrollListToTop()})}
  toggleStatus(value:string){this.status.setValue(this.status.value===value?'':value)}
  channelCount(row:AdsAuditRow,marketplace:string,account?:string){return row.canais.filter((c)=>c.marketplace.toUpperCase().includes(marketplace)&&(!account||c.conta.toLowerCase().includes(account.toLowerCase()))).reduce((sum,c)=>sum+c.quantidade,0)}
  otherCount(row:AdsAuditRow){return Math.max(0,row.totalAnuncios-this.channelCount(row,'MERCADO_LIVRE')-this.channelCount(row,'SHOPEE'))}
  statusClass(status:string){return status==='OK'?'ok':status==='SEM_ANUNCIO'?'error':'attention'}
  statusLabel(status:string){return status==='SEM_ANUNCIO'?'SEM ANÚNCIO':status==='POSSIVEL_DUPLICIDADE'?'DUPLICIDADE':'OK'}
  marketplaceLabel(value:string){return value.replaceAll('_',' ')}
  private scrollListToTop(){this.listScroll?.nativeElement.scrollTo({top:0,left:0,behavior:'auto'})}
}
