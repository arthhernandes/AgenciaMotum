import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Subject, finalize, takeUntil } from 'rxjs';
import { ApiService, Page } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';

@Component({
 selector:'app-activity', standalone:true, imports:[...UI_IMPORTS],
 template:`
 <header class="page-header"><div><h1>Histórico de atividades</h1><p>Alterações registradas de todos os usuários e contas. Horários de Brasília.</p></div><button mat-stroked-button (click)="load()" [disabled]="loading"><mat-icon>refresh</mat-icon>Atualizar</button></header>
 <section class="activity-filters" aria-label="Filtros do histórico">
 <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Usuário</mat-label><mat-select [formControl]="user"><mat-option value="">Todos</mat-option><mat-option *ngFor="let u of users" [value]="u.id">{{u.name}} · {{u.email}}</mat-option></mat-select></mat-form-field>
 <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Ação</mat-label><input matInput [formControl]="action" placeholder="Ex.: LISTING_EDITOR_UPDATE" (keyup.enter)="filter()"></mat-form-field>
 <label>Data inicial<input type="date" [formControl]="from"></label><label>Data final<input type="date" [formControl]="to"></label>
 <button mat-flat-button (click)="filter()" [disabled]="loading">Filtrar</button>
 </section>
 <p class="muted">O histórico contém as operações que o sistema registrou. Ações antigas sem registro não podem ser recuperadas.</p>
 <p *ngIf="error" role="alert">{{error}}</p><mat-progress-bar *ngIf="loading" mode="indeterminate"></mat-progress-bar>
 <div class="activity-table"><table><thead><tr><th>Data e hora</th><th>Usuário</th><th>Ação</th><th>Referência</th><th>Detalhes</th></tr></thead><tbody>
 <tr *ngFor="let row of rows"><td>{{row.createdAt | date:'dd/MM/yyyy HH:mm:ss':'-0300'}}</td><td><strong>{{row.user?.name || 'Usuário removido'}}</strong><small>{{row.user?.email}}</small></td><td>{{label(row.action)}}<small>{{row.action}}</small></td><td>{{row.entityId}}<small>{{row.entityType}}</small></td><td><details><summary>Ver alteração</summary><strong>Antes</strong><pre>{{row.before | json}}</pre><strong>Depois / resultado</strong><pre>{{row.after | json}}</pre></details></td></tr>
 <tr *ngIf="!loading && !rows.length && !error"><td colspan="5">Nenhuma atividade encontrada para os filtros informados.</td></tr>
 </tbody></table></div>
 <mat-paginator [length]="total" [pageIndex]="pageIndex" [pageSize]="pageSize" [pageSizeOptions]="[25,50,100]" (page)="pageIndex=$event.pageIndex;pageSize=$event.pageSize;load()" showFirstLastButtons aria-label="Páginas do histórico"></mat-paginator>
 `,
 styles:[`:host{display:flex;height:100%;min-height:0;flex-direction:column}.activity-filters{display:flex;align-items:end;gap:10px;flex-wrap:wrap}.activity-filters mat-form-field{width:260px}.activity-filters label{display:grid;gap:5px;font-size:12px}.activity-filters input[type=date]{padding:10px;border:1px solid #c6d7e4;border-radius:6px}.activity-table{flex:1;min-height:0;overflow:auto;border:1px solid #dce5ee;border-radius:10px;background:white}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}th,td{padding:12px;border-bottom:1px solid #e6edf3;vertical-align:top}th{position:sticky;top:0;background:#f8fafc;z-index:1}td{overflow-wrap:anywhere}td:first-child{white-space:nowrap}small{display:block;color:#697386;margin-top:4px}summary{cursor:pointer;color:#0d5275;white-space:nowrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:500px;max-height:280px;overflow:auto;font-size:11px}mat-paginator{flex-shrink:0}.muted{font-size:12px}`]
})
export class ActivityComponent implements OnInit,OnDestroy {
 user=new FormControl('');action=new FormControl('');from=new FormControl('');to=new FormControl('');
 users:any[]=[];rows:any[]=[];total=0;pageIndex=0;pageSize=25;loading=false;error='';
 private destroyed=new Subject<void>();private pending=new Subject<void>();
 constructor(private api:ApiService){}
 ngOnInit(){this.api.get<any[]>('/users').pipe(takeUntil(this.destroyed)).subscribe({next:users=>this.users=users,error:()=>this.error='Não foi possível carregar os usuários.'});this.load();}
 filter(){this.pageIndex=0;this.load();}
 load(){this.pending.next();this.loading=true;this.error='';this.api.get<Page<any>>('/users/activity',{page:this.pageIndex+1,limit:this.pageSize,userId:this.user.value||undefined,action:this.action.value?.trim()||undefined,from:this.from.value||undefined,to:this.to.value||undefined}).pipe(takeUntil(this.pending),takeUntil(this.destroyed),finalize(()=>this.loading=false)).subscribe({next:page=>{this.rows=page.data;this.total=page.pagination.total;},error:()=>{this.rows=[];this.total=0;this.error='Não foi possível carregar o histórico. Confira o período e tente novamente.';}});}
 label(action:string){return ({USER_CREATED:'Usuário criado',USER_UPDATED:'Usuário alterado',MANUAL_LINK:'SKU vinculado',UNLINK:'Vínculo removido',LISTING_EDITOR_UPDATE:'Anúncio editado',FISCAL_TEMPLATE:'Modelo fiscal criado',FISCAL_TEMPLATE_EDIT:'Modelo fiscal alterado',FISCAL_TEMPLATE_ARCHIVE:'Modelo fiscal arquivado',CHAT_ML_UPDATE_DETAIL:'Anúncio alterado pelo assistente',CHAT_ML_CREATE_DETAIL:'Anúncio criado pelo assistente',CHAT_LINK_SKU_DETAIL:'SKU vinculado pelo assistente'} as Record<string,string>)[action]||action;}
 ngOnDestroy(){this.destroyed.next();this.destroyed.complete();this.pending.complete();}
}
