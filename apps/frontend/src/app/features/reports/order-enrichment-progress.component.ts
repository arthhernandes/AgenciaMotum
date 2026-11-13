import { Component, OnInit, OnDestroy } from '@angular/core';
import { EMPTY, Subject, catchError, exhaustMap, takeUntil, takeWhile, timer } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';

@Component({selector:'app-order-enrichment-progress',standalone:true,imports:UI_IMPORTS,template:`
  <section *ngIf="visible && progress" class="enrichment" aria-label="Preenchimento do histórico de pedidos">
    <div class="heading"><div class="heading-title"><mat-icon>{{running?'sync':'task_alt'}}</mat-icon><div><strong>{{running?'Preenchendo custos do histórico':progress.status==='COMPLETED'?'Preenchimento concluído':'Conferência encerrada com pendências'}}</strong><small>Fretes e custos fiscais · todas as datas · duas contas</small></div></div><strong>{{progress.percent}}%</strong></div>
    <mat-progress-bar [mode]="progress.total?'determinate':'indeterminate'" [value]="progress.percent" aria-label="Progresso do preenchimento do histórico"></mat-progress-bar>
    <div class="accounts"><article *ngFor="let account of progress.accounts"><div><strong>{{account.account}}</strong><span>{{number(account.processed)}} de {{number(account.total)}} pedidos conferidos</span></div><mat-progress-bar mode="determinate" [value]="account.total?account.processed/account.total*100:0" [attr.aria-label]="'Progresso de '+account.account"></mat-progress-bar><div class="counts"><span>{{number(account.shippingFilled)}} fretes preenchidos</span><span>{{number(account.fiscalFilled)}} custos fiscais preenchidos</span><span *ngIf="account.failed">{{number(account.failed)}} falhas</span></div></article></div>
    <small *ngIf="updateFailed" class="error" role="status">Não foi possível atualizar o andamento. Tentando novamente…</small>
  </section>
`,styles:[`
 .enrichment{padding:16px;border:1px solid #b9d9e9;border-radius:12px;background:#edf6fb;margin:0 0 18px;color:#0d5275}.heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.heading-title{display:flex;align-items:center;gap:10px}.heading-title strong{font-size:13px}.heading small{display:block;margin-top:4px;color:#60788a;font-size:11px}.accounts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}.accounts article{padding:12px;border:1px solid #d4e5ef;border-radius:8px;background:#fff}.accounts article>div{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12px}.accounts mat-progress-bar{margin:10px 0}.counts{color:#60788a;font-size:11px!important}.error{display:block;margin-top:12px;color:#b42318}mat-progress-bar{border-radius:4px;overflow:hidden}@media(max-width:700px){.accounts{grid-template-columns:1fr}}@media print{.enrichment{display:none}}
`]})
export class OrderEnrichmentProgressComponent implements OnInit,OnDestroy {
  progress:any=null;visible=false;updateFailed=false;private seenRunning=false;private destroyed=new Subject<void>();
  constructor(private api:ApiService){}
  get running(){return this.progress?.status==='RUNNING';}
  number(value:number){return Number(value??0).toLocaleString('pt-BR');}
  ngOnInit(){timer(0,10000).pipe(exhaustMap(()=>this.api.get<any>('/reports/profitability/enrichment-status').pipe(catchError(()=>{this.updateFailed=true;return EMPTY;}))),takeWhile(result=>result.status==='RUNNING',true),takeUntil(this.destroyed)).subscribe(result=>{
    this.updateFailed=false;this.progress=result;
    if(this.running){this.seenRunning=true;this.visible=true;}
    else if(this.seenRunning){this.visible=true;timer(30000).pipe(takeUntil(this.destroyed)).subscribe(()=>this.visible=false);}
  });}
  ngOnDestroy(){this.destroyed.next();this.destroyed.complete();}
}
