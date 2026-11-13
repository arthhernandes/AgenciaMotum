import { ProfitabilityReportComponent } from './profitability-report.component';
import { AccessService } from '../../core/access.service';
import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, catchError, from, map, mergeMap, of, takeUntil } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';

@Component({selector:'app-reports',standalone:true,imports:[...UI_IMPORTS,FormsModule,ProfitabilityReportComponent],template:`
  <header class="page-header"><div><h1>Relatórios</h1><p>Desempenho dos anúncios da conta selecionada.</p></div><div class="report-actions" *ngIf="reportType==='listings'"><button mat-stroked-button (click)="printReport()" [disabled]="loading || visitsLoading || !report || !pageRows.length || reportType!=='listings'" title="Imprimir somente os itens da página atual"><mat-icon>print</mat-icon>Imprimir relatório</button><button mat-stroked-button (click)="load()" [disabled]="loading"><mat-icon>refresh</mat-icon>Atualizar</button></div></header>
  <div class="print-only" *ngIf="report"><strong>Conta: {{report.account}} · Período das visitas: {{periodLabel}}</strong><p>Ordenação: {{order==='sold'?'Mais vendidos por SKU':'Maior estoque'}}<span *ngIf="search"> · Busca: {{search}}</span></p><p>{{pageRows.length}} famílias · Página {{page+1}} · Itens {{page*pageSize+1}} a {{page*pageSize+pageRows.length}} da lista. “—” indica visitas não consultadas ou indisponíveis.</p></div>
  <section class="report-filters"><label>Tipo de relatório<select aria-label="Tipo de relatório" [(ngModel)]="reportType" (ngModelChange)="changeReportType()"><option value="listings">Desempenho dos anúncios</option><option *ngIf="access.can('costs.view')" value="profitability">Rentabilidade de pedidos</option></select></label><div><strong>Período do relatório</strong><small>{{reportType==='profitability'?'Pedidos pagos':'Visitas dos anúncios'}}</small></div><label>Data inicial<input type="date" [(ngModel)]="dateFrom" [max]="today"></label><label>Data final<input type="date" [(ngModel)]="dateTo" [max]="today"></label><button mat-flat-button (click)="apply()" [disabled]="loading">Aplicar período</button></section>
  <p class="error" role="alert" *ngIf="error">{{error}}</p><mat-progress-bar *ngIf="loading" mode="indeterminate"></mat-progress-bar>
  <app-profitability-report *ngIf="reportType==='profitability' && access.can('costs.view')" [dateFrom]="appliedDateFrom" [dateTo]="appliedDateTo"></app-profitability-report>
  <ng-container *ngIf="report && reportType==='listings'">
    <section>
      <div class="section-heading"><div><h2>{{order==='sold'?'Mais vendidos por SKU pai':'Desempenho por SKU pai'}}</h2><p>Estoque, status e vendidos refletem o cadastro atual. Vendidos são acumulados, sem filtro por data.</p></div></div>
      <div class="metrics"><article><small>Anúncios pai</small><strong>{{number(report.listings.summary.offers)}}</strong><span>{{number(report.listings.summary.families)}} famílias</span></article><article><small>Ativos</small><strong>{{number(report.listings.summary.statuses.active || 0)}}</strong><span>{{number(report.listings.summary.statuses.paused || 0)}} pausados</span></article><article><small>Unidades anunciadas</small><strong>{{number(report.listings.summary.units)}}</strong><span>Somadas por anúncio; pode haver estoque compartilhado</span></article><article><small>Vendidos informados</small><strong>{{number(report.listings.summary.sold)}}</strong><span>Acumulado nos anúncios</span></article></div>
      <div class="table-tools"><label class="search-label">Buscar anúncio<input [(ngModel)]="search" (ngModelChange)="resetPage()" placeholder="Família, SKU pai ou MLB"></label><label>Ordenar<select [(ngModel)]="order" (change)="resetPage()"><option value="sold">Mais vendidos por SKU</option><option value="stock">Maior estoque</option></select></label><button mat-stroked-button (click)="loadVisits()" [disabled]="visitsLoading || !pageRows.length"><mat-icon>visibility</mat-icon>{{visitsLoading?'Consultando visitas…':'Consultar visitas desta página'}}</button></div>
      <section class="visits-progress" *ngIf="visitsTotal>0" aria-live="polite">
        <div><span>{{visitsLoading?'Consultando visitas':'Consulta finalizada'}}</span><strong>{{visitsPercent}}%</strong></div>
        <mat-progress-bar mode="determinate" [value]="visitsPercent" aria-label="Progresso da consulta de visitas"></mat-progress-bar>
      </section>
      <p class="period-note">Visitas de {{periodLabel}}. A consulta usa os anúncios da página atual.</p>
      <div class="report-table"><table><thead><tr><th *ngIf="order==='sold'">Posição</th><th>SKU</th><th>Família</th><th>Status</th><th>Anúncios</th><th>Estoque</th><th>Vendidos</th><th>Visitas</th></tr></thead><tbody><tr *ngFor="let row of displayRows;let i=index"><td *ngIf="order==='sold'"><span class="ranking-position" [class.top-rank]="page===0 && i<3">{{page*pageSize+i+1}}º</span></td><td class="sku-cell"><strong>{{row.baseSku || '—'}}</strong></td><td class="family-cell"><strong>{{row.title}}</strong><small>{{row.baseSku?'SKU pai '+row.baseSku+' · '+row.parentCount+' anúncio(s) pai':row.itemIds.length===1?row.itemIds[0]:row.variants+' variações'}}</small></td><td><span class="status" [attr.data-state]="row.status">{{statusLabel(row.status)}}</span></td><td>{{number(row.parentCount)}}</td><td>{{number(row.stock)}}</td><td>{{number(row.sold)}}</td><td>{{visitsLoading?'…':visitTotal(row)===null?'—':number(visitTotal(row))}}</td></tr></tbody></table><p *ngIf="!filteredRows.length" class="empty">Nenhum anúncio encontrado.</p></div>
      <mat-paginator [length]="filteredRows.length" [pageIndex]="page" [pageSize]="pageSize" [pageSizeOptions]="[25,50,100]" (page)="changePage($event)" showFirstLastButtons></mat-paginator>
    </section>
    <p class="updated">Dados atualizados em {{report.generatedAt | date:'dd/MM/yyyy HH:mm':'-0300'}}.</p>
  </ng-container>
`,styles:[`
  .report-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.print-only{display:none}
  .visits-progress{margin:14px 0;padding:12px 14px;background:#edf5fa;border:1px solid #d6e5ef;border-radius:10px}.visits-progress>div{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px;color:#0d5275;font-size:12px}.visits-progress strong{font-variant-numeric:tabular-nums}.visits-progress mat-progress-bar{border-radius:4px;overflow:hidden}
  :host{display:block}.page-header p,.section-heading p{font-size:12px;color:#697386;margin:6px 0 0}.page-header button,.report-filters button,.table-tools button{height:36px;border-radius:8px;font-size:12px;white-space:nowrap}.report-filters{display:flex;align-items:flex-end;flex-wrap:wrap;gap:12px;padding:16px;border:1px solid #dce5ee;border-radius:12px;background:#fff;margin-bottom:16px}.report-filters>div{margin-right:auto;align-self:center;display:grid;gap:5px}.report-filters strong{font-size:13px}.report-filters small,.period-note,.updated{font-size:11px;color:#697386}label{display:grid;gap:6px;font-size:11px;color:#475467}input,select{box-sizing:border-box;height:36px;padding:7px 10px;border:1px solid #c6d7e4;border-radius:8px;background:#fff;color:#15374c;font:inherit;font-size:13px;min-width:0}.section-heading{margin:18px 0}.section-heading h2{font-size:18px;margin:0}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:20px}.metrics article{display:grid;align-content:start;gap:10px;padding:18px;background:#fff;border:1px solid #dce5ee;border-radius:12px}.metrics small{font-size:12px;color:#475467}.metrics strong{font-size:24px;color:#0d5275}.metrics span{font-size:11px;color:#697386;line-height:1.5}.table-tools{display:flex;align-items:flex-end;flex-wrap:wrap;gap:12px}.search-label{flex:1;min-width:180px}.report-table{overflow-x:auto;border:1px solid #dce5ee;border-radius:12px;background:#fff}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:14px;text-align:left;border-bottom:1px solid #e7edf3}th{font-size:10px;text-transform:uppercase;color:#697386;background:#f5f8fc}.family-cell{min-width:240px}.sku-cell{white-space:nowrap;color:#0d5275}.ranking-position{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:30px;border-radius:8px;background:#f2f4f7;color:#667085;font-weight:700}.ranking-position.top-rank{background:#deedf6;color:#0b4f78}td small{display:block;margin-top:6px;color:#697386}.status{display:inline-block;white-space:nowrap;padding:5px 8px;border-radius:7px;background:#eff2f6;color:#475467;font-size:11px;font-weight:600}.status[data-state=active],.status[data-state=SUCCESS]{background:#dcfae6;color:#067647}.status[data-state=paused],.status[data-state=PARTIAL]{background:#fff4d6;color:#934900}.status[data-state=FAILED]{background:#fee4e2;color:#b42318}.error{color:#b42318!important}.empty{padding:20px;text-align:center;color:#697386}.updated{text-align:right;margin:18px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font-size:11px}summary{cursor:pointer;color:#0d5275}@media(max-width:800px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.report-filters>div{width:100%}.table-tools button{width:100%}}@media(max-width:480px){.metrics{grid-template-columns:1fr}.report-filters label{flex:1;min-width:130px}.report-filters button{width:100%}}
  @media print{
    :host{height:auto!important;overflow:visible!important;color:#172033!important}
    .report-actions,.report-filters,.table-tools,.visits-progress,.period-note,.metrics,mat-paginator,mat-progress-bar,.page-header p,.section-heading p{display:none!important}
    .page-header{display:block!important;margin:0 0 6px!important;padding:0!important}.page-header h1{font-size:20px!important;margin:0!important;line-height:1.2!important}
    .print-only{display:block!important;margin:0 0 8px!important;font-size:10px!important;line-height:1.3!important}.print-only p{margin:3px 0!important}
    .section-heading{margin:8px 0!important}.section-heading h2{font-size:13px!important;margin:0!important}
    .report-table{overflow:visible!important;border:0!important;border-radius:0!important}
    table{font-size:10px!important;width:100%!important;line-height:1.25!important;border-collapse:collapse!important}
    th{font-size:9px!important;background:#edf2f6!important;color:#172033!important}
    th,td{padding:3px 6px!important;border-bottom:1px solid #dce3ea!important;overflow-wrap:break-word!important}
    .family-cell{min-width:0!important;width:40%!important}.family-cell>small{display:none!important}.family-cell>strong{font-weight:500!important}
    thead{display:table-header-group!important}tr{break-inside:avoid!important}
    .ranking-position{background:transparent!important;min-width:0!important;height:auto!important;border-radius:0!important;font-size:10px!important}
    .status{display:inline!important;padding:0!important;font-size:9px!important;line-height:1.2!important;border-radius:0!important;background:transparent!important;color:#475467!important}
    .updated{text-align:left!important;font-size:9px!important;margin:8px 0 0!important}
    *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  }
`]})
export class ReportsComponent implements OnInit,OnDestroy {
  printing=false;reportType='listings';
  report:any;loading=false;error='';search='';order='sold';page=0;pageSize=25;visitsLoading=false;visitsProcessed=0;visitsTotal=0;
  readonly today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  dateTo=this.today;dateFrom=new Date(Date.parse(this.today)-29*86400000).toISOString().slice(0,10);
  private period={dateFrom:this.dateFrom,dateTo:this.dateTo};private metrics=new Map<string,number>();private destroyed=new Subject<void>();private request?:Subscription;private visits?:Subscription;
  constructor(private api:ApiService,private changeDetector:ChangeDetectorRef,public access:AccessService){}
  ngOnInit(){
    try{const saved=JSON.parse(localStorage.getItem(this.preferencesKey)||'null');if(saved){const valid=(d:any)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;if(valid(saved.dateFrom)&&valid(saved.dateTo)&&saved.dateFrom<=saved.dateTo&&saved.dateTo<=this.today&&(Date.parse(saved.dateTo)-Date.parse(saved.dateFrom))/86400000<150){this.dateFrom=saved.dateFrom;this.dateTo=saved.dateTo;this.period={dateFrom:this.dateFrom,dateTo:this.dateTo};}if(saved.type==='profitability'&&this.access.can('costs.view'))this.reportType='profitability';}}catch{}
    this.load();
  }
  private get preferencesKey(){return 'reports-preferences:'+localStorage.getItem('selectedMarketplaceAccountId');}
  private remember(){localStorage.setItem(this.preferencesKey,JSON.stringify({...this.period,type:this.reportType}));}
  get appliedDateFrom(){return this.period.dateFrom;}
  get appliedDateTo(){return this.period.dateTo;}
  changeReportType(){this.remember();this.visits?.unsubscribe();this.visitsLoading=false;this.visitsProcessed=0;this.visitsTotal=0;}
  get periodLabel(){const format=(d:string)=>d.split('-').reverse().join('/');return format(this.period.dateFrom)+' a '+format(this.period.dateTo);}
  get filteredRows(){const term=this.search.trim().toLocaleLowerCase('pt-BR');return (this.report?.listings.rows??[]).filter((r:any)=>!term||r.title.toLocaleLowerCase('pt-BR').includes(term)||String(r.baseSku||'').toLowerCase().includes(term)||r.itemIds.some((id:string)=>id.toLowerCase().includes(term))).sort((a:any,b:any)=>b[this.order]-a[this.order]||String(a.baseSku||a.id).localeCompare(String(b.baseSku||b.id),'pt-BR',{numeric:true}));}
  get displayRows(){return this.pageRows;}
  get pageRows(){return this.filteredRows.slice(this.page*this.pageSize,(this.page+1)*this.pageSize);}
  get visitsPercent(){return this.visitsTotal?Math.min(100,Math.floor(this.visitsProcessed/this.visitsTotal*100)):0;}
  resetPage(){this.page=0;this.visits?.unsubscribe();this.visitsLoading=false;this.visitsProcessed=0;this.visitsTotal=0;}
  changePage(event:any){this.page=event.pageIndex;this.pageSize=event.pageSize;this.visits?.unsubscribe();this.visitsLoading=false;this.visitsProcessed=0;this.visitsTotal=0;}
  apply(){if(!this.dateFrom||!this.dateTo||this.dateFrom>this.dateTo||this.dateTo>this.today||(Date.parse(this.dateTo)-Date.parse(this.dateFrom))/86400000+1>150){this.error='Selecione datas válidas, sem datas futuras, em um intervalo de até 150 dias.';return;}this.period={dateFrom:this.dateFrom,dateTo:this.dateTo};this.remember();this.load();}
  load(){this.request?.unsubscribe();this.visits?.unsubscribe();this.visitsLoading=false;this.visitsProcessed=0;this.visitsTotal=0;this.metrics.clear();this.loading=true;this.error='';this.request=this.api.get<any>('/reports',this.period).pipe(takeUntil(this.destroyed)).subscribe({next:r=>{this.report=r;this.loading=false;this.page=0;},error:()=>{this.report=null;this.loading=false;this.error='Não foi possível carregar os relatórios. Tente atualizar.';}});}
  loadVisits(){this.visits?.unsubscribe();const ids=[...new Set<string>(this.pageRows.flatMap((r:any)=>r.itemIds))],batches:string[][]=[];for(let i=0;i<ids.length;i+=20)batches.push(ids.slice(i,i+20));this.visitsProcessed=0;this.visitsTotal=ids.length;this.visitsLoading=ids.length>0;this.visits=from(batches).pipe(mergeMap(ids=>this.api.post<any>('/listings/visits',{ids,...this.period}).pipe(catchError(()=>of({items:[]})),map(response=>({...response,processed:ids.length}))),2),takeUntil(this.destroyed)).subscribe({next:r=>{this.visitsProcessed+=r.processed;for(const item of r.items??[])if(Number.isSafeInteger(item.visits))this.metrics.set(item.itemId,item.visits);},complete:()=>this.visitsLoading=false});}
  visitTotal(row:any){const known=row.itemIds.filter((id:string)=>this.metrics.has(id));return known.length?known.reduce((sum:number,id:string)=>sum+this.metrics.get(id)!,0):null;}
  number(value:unknown){return Number(value??0).toLocaleString('pt-BR');}
  statusLabel(value:string){return ({active:'Ativo',paused:'Pausado',closed:'Encerrado',under_review:'Em análise',inactive:'Inativo',mixed:'Variados',SUCCESS:'Concluída',PARTIAL:'Com alertas',FAILED:'Falhou',PENDING:'Pendente',RUNNING:'Em andamento',PAUSED:'Pausada',CANCELLED:'Cancelada'} as Record<string,string>)[value]||value;}
  printReport(){
    if(!this.report||this.loading||this.visitsLoading||this.reportType!=='listings')return;
    this.preparePrint();
    try{window.print();}finally{this.finishPrint();}
  }
  @HostListener('window:beforeprint')
  preparePrint(){if(!this.report||this.reportType!=='listings')return;this.printing=true;document.body.classList.add('printing-report');this.changeDetector.detectChanges();}
  @HostListener('window:afterprint')
  finishPrint(){this.printing=false;document.body.classList.remove('printing-report');this.changeDetector.detectChanges();}
  ngOnDestroy(){document.body.classList.remove('printing-report');this.destroyed.next();this.destroyed.complete();}
}
