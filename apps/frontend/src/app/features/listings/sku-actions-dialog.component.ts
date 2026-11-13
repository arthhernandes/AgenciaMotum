import { Component, Inject, OnDestroy } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';
import { SkuLinkDialogComponent } from './sku-link-dialog.component';
import { AddVariationsDialogComponent } from './add-variations-dialog.component';
import { ListingFiscalDialogComponent } from './listing-fiscal-dialog.component';
import { SkuAuditComponent } from './sku-audit.component';

@Component({selector:'app-sku-actions-dialog',standalone:true,imports:[...UI_IMPORTS,MatDialogModule,SkuAuditComponent],template:`
  <h2 mat-dialog-title>{{selectionMode ? 'Edição em massa dos selecionados' : 'Edição em massa por SKU pai'}}</h2>
  <mat-dialog-content>
    <p>{{selectionMode ? 'Escolha a ação para os anúncios marcados na tabela. Cada anúncio terá sua própria revisão.' : 'Informe o SKU pai da Bling para localizar os anúncios do produto na conta selecionada.'}}</p>
    <div class="sku-search" *ngIf="!selectionMode"><mat-form-field appearance="outline"><mat-label>SKU pai</mat-label><input matInput [formControl]="sku" [readonly]="busy || running" (keydown.enter)="find()" (input)="clear()"></mat-form-field><button mat-flat-button color="primary" (click)="find()" [disabled]="busy || running || sku.invalid"><mat-icon>search</mat-icon>Localizar anúncios</button></div>
    <mat-progress-bar *ngIf="busy" mode="indeterminate"></mat-progress-bar>
    <p *ngIf="error" role="alert" class="error">{{ error }}</p>
    <section *ngIf="cancelTarget" class="outcomes" role="alert"><h3>{{cancelTarget.reference?'Cancelar esta etapa?':'Cancelar toda a fila?'}}</h3><p>As etapas concluídas serão preservadas. O sistema interrompe as próximas etapas e solicita a parada das publicações iniciadas por estes anúncios desde a criação da fila. Uma solicitação já enviada ao Mercado Livre pode concluir e não será desfeita.</p><button mat-flat-button color="warn" [disabled]="cancelling" (click)="confirmCancel()">{{cancelling?'Cancelando...':'Confirmar cancelamento'}}</button><button mat-button [disabled]="cancelling" (click)="cancelTarget=undefined">Voltar</button></section>
    <p *ngIf="cancelMessage" class="outcomes" role="status">{{cancelMessage}}</p>
    <section class="outcomes" *ngIf="visibleQueues.length"><h3>Fila de operações</h3><p class="hint">Filas salvas nesta conta e usuário. Retomar abre as etapas pendentes para revisão. Etapas concluídas não são repetidas.</p><details *ngFor="let queue of visibleQueues"><summary>{{queue.selection ? 'Seleção de anúncios' : 'SKU '+queue.sku}} · {{kindLabel(queue.kind)}} · {{countDone(queue)}}/{{visibleTasks(queue).length}} concluídos</summary><p *ngFor="let task of visibleTasks(queue)"><strong>{{task.reference}}</strong> · {{statusLabel(task.status)}}<br>{{task.message}} <button mat-button color="warn" *ngIf="canCancelTask(task)" [disabled]="cancelling" (click)="askCancel(queue,task.reference)">Cancelar etapa</button> <button mat-button *ngIf="task.status==='RUNNING' || task.status==='REVIEW'" [disabled]="running" (click)="release(queue,task)">Conferi o anúncio; liberar revisão</button></p><button mat-stroked-button (click)="resume(queue)" [disabled]="running || busy || !hasPending(queue)">Retomar pendentes</button> <button mat-stroked-button color="warn" *ngIf="canCancelQueue(queue)" [disabled]="cancelling" (click)="askCancel(queue)">Cancelar fila</button></details></section>
    <ng-container *ngIf="product">
      <section class="product"><span>{{selectionMode ? 'ANÚNCIOS SELECIONADOS' : 'SKU '+product.sku}}</span><h3>{{ product.title }}</h3><p><span *ngIf="!selectionMode">{{ product.variants }} variações Bling · </span>{{ product.announcements.length }} anúncio(s) ou famílias identificadas</p></section>
      <p *ngIf="!product.found && !selectionMode" class="hint">Confira o SKU pai e sincronize o catálogo Bling se necessário.</p>
      <p *ngIf="product.found && !product.announcements.length" class="hint">Nenhum anúncio identificado pelos vínculos ou SKUs atuais. Se o anúncio estiver com SKU incorreto ou ausente, use primeiro “Vincular SKU” na lista de anúncios.</p>
      <app-sku-audit *ngIf="product.found" [sku]="product.sku" [revision]="revision"></app-sku-audit>
      <ng-container *ngIf="product.announcements.length">
        <div class="selection-heading"><strong>{{ selected.size }} selecionado(s)</strong><button mat-button (click)="selectAll()" [disabled]="running">Selecionar todos</button><button mat-button (click)="selected.clear()" [disabled]="running">Limpar seleção</button></div>
        <div class="announcements"><label *ngFor="let ad of product.announcements"><input type="checkbox" [checked]="selected.has(ad.id)" [disabled]="running || ad.conflict" (change)="toggle(ad.id)"><div><strong>{{ ad.title }}</strong><small>{{ ad.items.join(' · ') }}</small><small>{{ ad.variations }} variações</small><small *ngIf="ad.conflict" class="error">Anúncio associado a mais de um SKU pai. Revise os vínculos antes de aplicar ações.</small></div></label></div>
        <div class="action-bar"><button mat-stroked-button (click)="run('sku')" [disabled]="running || !selected.size"><mat-icon>link</mat-icon>Vincular SKUs</button><button mat-stroked-button (click)="run('variations')" [disabled]="running || !selected.size"><mat-icon>playlist_add</mat-icon>Adicionar variações</button><button mat-stroked-button appPermission="costs.view" (click)="run('fiscal')" [disabled]="running || !selected.size"><mat-icon>receipt_long</mat-icon>Dados fiscais</button></div>
        <p class="hint">A ação será aberta para cada anúncio selecionado, um de cada vez. Você pode revisar as opções de cada anúncio. Cancelar uma etapa interrompe a sequência.</p>
      </ng-container>
    </ng-container>
    <p *ngIf="running" role="status">Operação {{queueProgress}}. A próxima etapa abre após fechar o resultado atual.</p>
    <section *ngIf="outcomes.length" class="outcomes" role="status"><h3>Resultados</h3><p *ngFor="let item of outcomes"><strong>{{ item.reference }}</strong> · {{ item.message }}</p></section>
  </mat-dialog-content>
  <mat-dialog-actions align="end"><button mat-button (click)="ref.close()" [disabled]="running">Fechar</button></mat-dialog-actions>
`,styles:[`.sku-search{display:flex;gap:14px;align-items:center}.sku-search mat-form-field{width:250px}.sku-search button{margin-bottom:20px;border-radius:10px}.product{padding:18px;background:#f0f7fb;border:1px solid #d4e7f2;border-radius:12px;margin-bottom:18px}.product>span{font-size:12px;color:#0d5275;font-weight:600}.product h3{margin:8px 0;font-size:18px}.product p{margin:0;color:#667085;font-size:13px}.selection-heading{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px}.selection-heading strong{margin-right:auto}.announcements{border:1px solid #e4e7ec;border-radius:12px;max-height:350px;overflow:auto}.announcements label{display:flex;gap:14px;padding:16px;border-bottom:1px solid #edf0f4}.announcements input{accent-color:#0d5275;width:17px;height:17px;flex-shrink:0}.announcements small{display:block;margin-top:6px;color:#667085}.action-bar{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0 12px}.action-bar button{border-radius:9px}.hint{font-size:12px;color:#667085;line-height:1.6}.error{color:#b42318!important}.outcomes{padding:16px;border-radius:12px;background:#f6f9fc;font-size:13px}.outcomes p{white-space:pre-line;line-height:1.5}@media(max-width:550px){.sku-search{display:block}.sku-search mat-form-field{width:100%}}`]})
export class SkuActionsDialogComponent implements OnDestroy {
  sku=new FormControl('',{nonNullable:true,validators:[Validators.required,Validators.pattern(/\S/)]});
  product:any;selected=new Set<string>();busy=false;running=false;error='';outcomes:Array<{reference:string;message:string}>=[];
  queues:any[]=[];revision=0;queueProgress='';
  visibleTasks(queue:any){return queue.tasks.filter((task:any)=>task.status!=='CANCELLED');}
  get visibleQueues(){return this.queues.filter(queue=>queue.tasks.some((task:any)=>!['SUCCESS','CANCELLED'].includes(task.status))||!queue.tasks.some((task:any)=>task.status==='CANCELLED'));}
  cancelling=false;cancelTarget:{queue:any;reference?:string}|undefined;cancelMessage='';
  canCancelTask(task:any){return !['SUCCESS','CANCELLED'].includes(task.status);}
  canCancelQueue(queue:any){return queue.tasks.some((task:any)=>this.canCancelTask(task));}
  askCancel(queue:any,reference?:string){this.cancelTarget={queue,reference};this.cancelMessage='';}
  async confirmCancel(){
    if(!this.cancelTarget||this.cancelling||!this.contextValid())return;
    const target=this.cancelTarget;this.cancelling=true;this.error='';
    try{const result=await firstValueFrom(this.api.post<any>('/listing-links/sku/queues/'+target.queue.id+'/cancel',target.reference?{reference:target.reference}:{}));Object.assign(target.queue,result);this.cancelMessage=result.message;this.cancelTarget=undefined;this.loadQueues();}
    catch(error){this.queueError(error);}finally{this.cancelling=false;}
  }
  private readonly accountId=localStorage.getItem('selectedMarketplaceAccountId');private readonly destroyed=new Subject<void>();
  get selectionMode(){return !!this.data.initialAnnouncements?.length;}
  constructor(private readonly api:ApiService,private readonly dialog:MatDialog,public readonly ref:MatDialogRef<SkuActionsDialogComponent>,@Inject(MAT_DIALOG_DATA) readonly data:{initialSku?:string;initialAnnouncements?:any[];onUpdated:()=>void}){this.loadQueues();if(this.selectionMode){this.product={sku:'',title:'Anúncios selecionados na tabela',found:false,variants:0,announcements:data.initialAnnouncements};this.selectAll();}else if(data.initialSku){this.sku.setValue(data.initialSku);this.find();}}
  clear(){if(this.busy||this.running)return;this.product=undefined;this.selected.clear();this.outcomes=[];this.error='';}
  find(){if(this.busy||this.running||this.sku.invalid||!this.contextValid())return;this.busy=true;this.error='';this.outcomes=[];this.api.post<any>('/listing-links/sku/actions',{skus:[this.sku.value.trim()]}).pipe(takeUntil(this.destroyed)).subscribe({next:value=>{this.product=value.rows[0];this.selectAll();this.busy=false;},error:error=>{this.error=typeof error.error?.message==='string'?error.error.message:'Não foi possível localizar os anúncios.';this.busy=false;}});}
  selectAll(){this.selected=new Set((this.product?.announcements??[]).filter((ad:any)=>!ad.conflict).map((ad:any)=>ad.id));}
  toggle(id:string){if(this.selected.has(id))this.selected.delete(id);else this.selected.add(id);}

  kindLabel(kind:string){return ({sku:'Corrigir SKUs',variations:'Adicionar variações',fiscal:'Dados fiscais'} as any)[kind]||kind;}
  statusLabel(status:string){return ({PENDING:'Pendente',RUNNING:'Em execução / conferir se interrompida',SUCCESS:'Concluída',FAILED:'Falhou',PAUSED:'Aguardando revisão',REVIEW:'Resultado precisa de conferência',CANCELLED:'Cancelada'} as any)[status]||status;}
  countDone(queue:any){return queue.tasks.filter((task:any)=>task.status==='SUCCESS').length;}
  hasPending(queue:any){return queue.tasks.some((task:any)=>['PENDING','PAUSED','FAILED'].includes(task.status));}
  loadQueues(){this.api.get<any[]>('/listing-links/sku/queues').pipe(takeUntil(this.destroyed)).subscribe({next:value=>this.queues=value,error:()=>this.error='Não foi possível carregar as filas salvas.'});}
  async release(queue:any,task:any){
    if(this.running||!this.contextValid())return;
    try{if(task.status==='RUNNING')await this.updateTask(queue,task,'REVIEW','Etapa interrompida; confira o resultado no anúncio.');await this.updateTask(queue,task,'PAUSED','Conferência manual solicitada pelo usuário; próxima execução abrirá revisão atualizada.');this.loadQueues();}catch(error){this.queueError(error);}
  }
  async run(kind:'sku'|'variations'|'fiscal'){
    if(this.running||!this.selected.size||!this.contextValid())return;
    this.running=true;this.ref.disableClose=true;
    try{const queue=await firstValueFrom(this.api.post<any>('/listing-links/sku/queues'+(this.selectionMode?'/selection':''),{...(!this.selectionMode?{sku:this.product.sku}:{}),kind,references:this.product.announcements.filter((ad:any)=>this.selected.has(ad.id)&&!ad.conflict).map((ad:any)=>ad.reference)}));await this.executeQueue(queue);}
    catch(error){this.queueError(error);}finally{this.running=false;this.ref.disableClose=false;this.loadQueues();}
  }
  async resume(queue:any){
    if(this.running||!this.contextValid())return;
    this.running=true;this.ref.disableClose=true;
    try{const latest=await firstValueFrom(this.api.get<any[]>('/listing-links/sku/queues'));const current=latest.find(item=>item.id===queue.id);if(!current)throw new Error('Fila não encontrada.');await this.executeQueue(current);}
    catch(error){this.queueError(error);}finally{this.running=false;this.ref.disableClose=false;this.loadQueues();}
  }
  private async updateTask(queue:any,task:any,status:string,message:string){
    if(!this.contextValid())throw new Error('Conta alterada. Abra novamente a janela.');
    const updated=await firstValueFrom(this.api.post<any>('/listing-links/sku/queues/'+queue.id,{reference:task.reference,status,message}));Object.assign(queue,updated);return updated;
  }
  private async executeQueue(queue:any){
    this.outcomes=[];this.error='';
    const tasks=queue.tasks.filter((task:any)=>['PENDING','PAUSED','FAILED'].includes(task.status));
    for(const task of tasks){
      if(!this.contextValid())break;
      await this.updateTask(queue,task,'RUNNING','Revisão aberta. Se interrompida, confira o anúncio antes de repetir.');
      const activeTasks=this.visibleTasks(queue);
      const batchProgress={index:activeTasks.findIndex((entry:any)=>entry.reference===task.reference)+1,total:activeTasks.length};
      this.queueProgress=batchProgress.index+' de '+batchProgress.total;
      const config={data:{batchProgress,reference:task.reference,title:task.title,parentSku:task.parentSku||queue.sku||undefined,onUpdated:()=>{this.data.onUpdated();this.revision++;}},width:'1150px',maxWidth:'97vw',maxHeight:'94vh'};
      const child=queue.kind==='sku'?this.dialog.open(SkuLinkDialogComponent,config):queue.kind==='variations'?this.dialog.open(AddVariationsDialogComponent,config):this.dialog.open(ListingFiscalDialogComponent,config);
      const result=await firstValueFrom(child.afterClosed());this.data.onUpdated();this.revision++;
      const message=result?.message||(result?.completed?(result.success?'Concluído.':'Resultado precisa de conferência.'):'Sequência interrompida. Confira se houve envio antes de retomar.');
      await this.updateTask(queue,task,result?.completed?(result.success?'SUCCESS':'REVIEW'):'REVIEW',message);
      this.outcomes.push({reference:task.reference,message});
      if(!result?.completed)break;
    }
  }
  private queueError(error:any){this.error=typeof error?.error?.message==='string'?error.error.message:(error?.message||'Não foi possível atualizar a fila. Confira as etapas antes de retomar.');}
  private contextValid(){if(this.accountId&&this.accountId===localStorage.getItem('selectedMarketplaceAccountId'))return true;this.error='A conta mudou. Feche e abra esta janela novamente.';return false;}
  ngOnDestroy(){this.destroyed.next();this.destroyed.complete();}
}
