import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormControl } from '@angular/forms';
import { combineLatest, debounceTime, startWith, switchMap, takeWhile, timer } from 'rxjs';
import { ApiService, Page } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';

@Component({
  selector: 'app-products', standalone: true, imports: UI_IMPORTS,
  template: `
    <header class="page-header"><div><h1>Catálogo Bling</h1><p class="muted">Produtos agrupados pelo SKU base, com suas variações.</p></div><div class="header-actions"><button mat-flat-button color="primary" (click)="syncBling()" [disabled]="syncing"><mat-icon>sync</mat-icon>{{ syncing ? 'Sincronizando…' : 'Puxar produtos da Bling' }}</button><mat-form-field appearance="outline" class="search"><mat-label>Buscar produto ou SKU</mat-label><input matInput [formControl]="search"></mat-form-field></div></header>
    <section class="sync-progress" *ngIf="currentExecution"><div><strong>Sincronização Bling</strong><small>{{ progress.message }}</small></div><mat-progress-bar [mode]="progress.total ? 'determinate' : 'indeterminate'" [value]="progress.percent"></mat-progress-bar><span class="status-chip" [class]="statusClass(currentExecution.status)">{{ currentExecution.status }}</span></section>
    <section class="filter-row">
      <mat-form-field appearance="outline"><mat-label>Vínculo</mat-label><mat-select [formControl]="hasListing"><mat-option value="">Todos</mat-option><mat-option value="true">Vinculados</mat-option><mat-option value="false">Pendentes</mat-option></mat-select></mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Status do anúncio</mat-label><mat-select [formControl]="listingStatus"><mat-option value="">Todos</mat-option><mat-option value="active">Ativo</mat-option><mat-option value="paused">Pausado</mat-option><mat-option value="closed">Encerrado</mat-option></mat-select></mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Problemas</mat-label><mat-select [formControl]="hasIssues"><mat-option value="">Todos</mat-option><mat-option value="true">Com problemas</mat-option></mat-select></mat-form-field>
    </section>
    <div class="list-scroll" #listScroll>
    <table mat-table [dataSource]="products" multiTemplateDataRows class="data-table product-table">
      <ng-container matColumnDef="title"><th mat-header-cell *matHeaderCellDef>Produto base</th><td mat-cell *matCellDef="let row"><strong>{{ row.title }}</strong><small>{{ row.category }}</small></td></ng-container>
      <ng-container matColumnDef="sku"><th mat-header-cell *matHeaderCellDef>SKU base</th><td mat-cell *matCellDef="let row"><strong>{{ row.sku }}</strong></td></ng-container>
      <ng-container matColumnDef="variants"><th mat-header-cell *matHeaderCellDef>Variações</th><td mat-cell *matCellDef="let row"><button mat-stroked-button class="variant-button" (click)="$event.stopPropagation(); toggle(row)"><mat-icon>{{ selected?.id === row.id ? 'expand_less' : 'expand_more' }}</mat-icon>{{ row.variants?.length || 0 }} variações</button></td></ng-container>
      <ng-container matColumnDef="listings"><th mat-header-cell *matHeaderCellDef>Vínculos</th><td mat-cell *matCellDef="let row">{{ row.links?.length || 0 }}</td></ng-container>
      <ng-container matColumnDef="issues"><th mat-header-cell *matHeaderCellDef>Problemas</th><td mat-cell *matCellDef="let row">{{ row.issues?.length || 0 }}</td></ng-container>
      <ng-container matColumnDef="expandedDetail"><td mat-cell *matCellDef="let row" [attr.colspan]="columns.length"><div class="variant-panel" *ngIf="selected?.id === row.id"><header><div><span class="muted">VARIAÇÕES DO SKU BASE</span><h2>{{ row.sku }} · {{ row.title }}</h2></div><button mat-icon-button (click)="selected = null"><mat-icon>close</mat-icon></button></header><div class="color-groups" *ngIf="row.variants?.length; else noVariants"><section class="color-group" *ngFor="let group of groupVariants(row.variants)"><div class="color-title"><span class="color-dot"></span><div><strong>{{ group.color }}</strong><small>{{ group.variants.length }} {{ group.variants.length === 1 ? 'variação' : 'variações' }}</small></div></div><div class="variant-grid"><article *ngFor="let variant of group.variants"><div><strong>{{ variant.size || 'Sem tamanho' }}</strong><small>SKU {{ variant.sku }}</small></div><span><small>Estoque</small><strong>{{ variant.stock }}</strong></span></article></div></section></div><ng-template #noVariants><p class="muted">Este produto não possui variações cadastradas.</p></ng-template></div></td></ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns" class="product-row" [class.expanded]="selected?.id === row.id" (click)="toggle(row)"></tr>
      <tr mat-row *matRowDef="let row; columns: ['expandedDetail']" class="detail-row"></tr>
    </table>
    </div>
    <mat-paginator [length]="total" [pageIndex]="page - 1" [pageSize]="limit" [pageSizeOptions]="[25, 50, 100, 200]" showFirstLastButtons (page)="changePage($event)" aria-label="Navegar por todos os produtos"></mat-paginator>
  `,
  styles: [`
    .page-header p{margin:5px 0 0}.header-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.sync-progress{display:grid;grid-template-columns:minmax(220px,320px) 1fr auto;align-items:center;gap:16px;margin:0 0 20px;padding:12px 0;border-bottom:1px solid #d6d8df}.sync-progress div{display:grid;gap:4px}.sync-progress small{color:#5d6472}.variant-button{white-space:nowrap}.product-row{cursor:pointer}.product-row:hover,.product-row.expanded{background:#f5f8ff}.detail-row{height:0}.detail-row td{padding:0!important;border-bottom-width:0}.variant-panel{padding:20px 24px;background:#f8faff;border-top:1px solid #d6e4ff;border-bottom:1px solid #d6e4ff}.variant-panel header{display:flex;justify-content:space-between;align-items:flex-start}.variant-panel h2{margin:4px 0 18px;font-size:19px}.color-groups{display:grid;gap:16px}.color-group{background:#fff;border:1px solid #d6e4ff;border-radius:12px;padding:14px}.color-title{display:flex;align-items:center;gap:10px;margin-bottom:12px}.color-title>div{display:grid;gap:2px}.color-title small{color:#667085}.color-dot{width:12px;height:12px;border-radius:50%;background:#155eef;box-shadow:0 0 0 4px #eaf0ff}.variant-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px}.variant-grid article{display:flex;justify-content:space-between;align-items:center;border:1px solid #eaecf0;border-radius:9px;padding:11px 13px;background:#f9fafb}.variant-grid article div,.variant-grid article>span{display:grid;gap:3px}.variant-grid article small{color:#667085}.variant-grid article>span{text-align:right}@media(max-width:720px){.sync-progress{grid-template-columns:1fr}.header-actions{width:100%}.search{width:100%}}
  `]
})
export class ProductsComponent implements OnInit {
  @ViewChild('listScroll') private listScroll?: ElementRef<HTMLElement>;
  search=new FormControl(''); hasListing=new FormControl(''); listingStatus=new FormControl(''); hasIssues=new FormControl('');
  products:any[]=[]; selected:any|null=null; currentExecution:any|null=null; progress={total:0,percent:0,message:'Aguardando sincronização'}; syncing=false;
  page=1; limit=50; total=0;
  columns=['title','sku','variants','listings','issues'];
  constructor(private readonly api:ApiService){}
  ngOnInit(){this.loadProducts()}
  loadProducts(){combineLatest([this.search.valueChanges.pipe(startWith('')),this.hasListing.valueChanges.pipe(startWith('')),this.listingStatus.valueChanges.pipe(startWith('')),this.hasIssues.valueChanges.pipe(startWith(''))]).pipe(debounceTime(300),switchMap(()=>{this.page=1;return this.fetchProducts()})).subscribe((result)=>this.applyPage(result))}
  changePage(event:any){this.page=event.pageIndex+1;this.limit=event.pageSize;this.selected=null;this.fetchProducts().subscribe((result)=>{this.applyPage(result);this.scrollListToTop()})}
  toggle(row:any){this.selected=this.selected?.id===row.id?null:row}
  groupVariants(variants:any[]){
    const groups=new Map<string,any[]>();
    for(const variant of variants??[]){const color=(variant.color||'Sem cor informada').trim();groups.set(color,[...(groups.get(color)??[]),variant])}
    const sizeOrder=['PP','P','M','G','GG','XG','XGG','XXG','XXXG'];
    return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b,'pt-BR')).map(([color,items])=>({color,variants:items.sort((a,b)=>{const left=sizeOrder.indexOf(String(a.size??'').toUpperCase());const right=sizeOrder.indexOf(String(b.size??'').toUpperCase());if(left>=0||right>=0)return(left<0?999:left)-(right<0?999:right);return String(a.size??'').localeCompare(String(b.size??''),'pt-BR',{numeric:true})})}))
  }
  syncBling(){this.syncing=true;this.api.post<any>('/sync/bling').subscribe({next:(execution)=>{this.currentExecution=execution;this.applyProgress(execution);this.pollExecution(execution.id)},error:()=>this.syncing=false})}
  statusClass(status:string){if(status==='SUCCESS')return'ok';if(['FAILED','CANCELLED'].includes(status))return'error';return'attention'}
  private pollExecution(id:string){timer(0,1000).pipe(switchMap(()=>this.api.get<any>(`/sync/executions/${id}`)),takeWhile((execution)=>['PENDING','RUNNING','PAUSED'].includes(execution.status),true)).subscribe({next:(execution)=>{this.currentExecution=execution;this.applyProgress(execution);this.syncing=['PENDING','RUNNING','PAUSED'].includes(execution.status);if(!this.syncing)this.refreshProducts()},error:()=>this.syncing=false})}
  private fetchProducts(){return this.api.get<Page<any>>('/products',{page:this.page,limit:this.limit,search:this.search.value??'',hasListing:this.hasListing.value??'',listingStatus:this.listingStatus.value??'',hasIssues:this.hasIssues.value??''})}
  private applyPage(result:Page<any>){this.products=result.data;this.page=result.pagination.page;this.limit=result.pagination.limit;this.total=result.pagination.total;if(this.selected)this.selected=this.products.find((row)=>row.id===this.selected.id)??null}
  private refreshProducts(){this.fetchProducts().subscribe((result)=>this.applyPage(result))}
  private scrollListToTop(){this.listScroll?.nativeElement.scrollTo({top:0,left:0,behavior:'auto'})}
  private applyProgress(execution:any){const progress=execution.errorDetails?.progress??{};this.progress={total:Number(progress.total??execution.itemsProcessed??0),percent:Number(progress.percent??0),message:progress.message??`${execution.itemsProcessed??0} produtos processados`}}
}
