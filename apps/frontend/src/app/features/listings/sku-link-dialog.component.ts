import { BatchProgress, BatchProgressComponent } from './batch-progress.component';
import { Component, Inject, OnDestroy } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom, Subject, switchMap, takeUntil, throwError } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';
import { AddVariationsDialogComponent } from './add-variations-dialog.component';
import { compareSizes, equivalentSize } from './size-order';

@Component({
  selector: 'app-sku-link-dialog', standalone: true, imports: [...UI_IMPORTS, MatDialogModule, BatchProgressComponent],
  template: `
    <h2 mat-dialog-title>Vincular SKU correto</h2>
    <app-batch-progress [progress]="data.batchProgress"></app-batch-progress>
    <mat-dialog-content>
      <p>{{ data.title }}</p>
      <div class="link-mode" *ngIf="!finished"><button mat-stroked-button (click)="setManual(false)" [disabled]="busy" [attr.aria-pressed]="!manualMode">Automático (recomendado)</button><button mat-stroked-button (click)="setManual(true)" [disabled]="busy" [attr.aria-pressed]="manualMode">Vincular manualmente</button></div><p *ngIf="manualMode && !finished">Informe o SKU pai e carregue as variações. Selecione a variação Bling desejada para cada oferta, sem correspondência automática. Cores diferentes são permitidas; o tamanho precisa ser compatível.</p><p *ngIf="!finished && !manualMode">Informe o SKU pai da Bling. Ao aplicar, o sistema compara cor e tamanho e corrige os SKUs no Mercado Livre e os vínculos no Consultor automaticamente.</p>
      <mat-form-field *ngIf="!finished" appearance="outline"><mat-label>SKU pai na Bling</mat-label><input matInput [formControl]="parentSku" [readonly]="busy" (input)="resetChoices()" (keydown.enter)="manualMode ? loadManual() : apply()"></mat-form-field>
      <mat-form-field *ngIf="!finished" appearance="outline" class="second-parent"><mat-label>Outro SKU pai (opcional)</mat-label><input matInput [formControl]="secondParentSku" [readonly]="busy" placeholder="Ex.: 5484-LINHA2" (input)="resetChoices()" (keydown.enter)="loadManual()"></mat-form-field><p *ngIf="!finished && (manualMode || secondParentSku.value)" class="parent-hint">Para usar LINHA1 e LINHA2 no mesmo anúncio, informe um SKU pai em cada campo. As listas mostrarão as variações das duas linhas com tamanho compatível. No modo automático, o sistema compara cor e tamanho nas duas linhas; se houver mais de uma correspondência, você escolhe. No manual, escolha cada variação.</p><mat-progress-bar *ngIf="busy" mode="indeterminate"></mat-progress-bar>
      <p role="alert" *ngIf="error">{{ error }}</p>
      <section *ngIf="manualRows.length && !finished && !manualProposal">
        <p *ngIf="manualMode">Escolha uma das variações do SKU pai em cada lista. As opções mostram SKU, cor e tamanho compatível com a oferta. Nenhuma opção é selecionada automaticamente.</p><p class="parent-hint">Você pode escolher <strong>Deixar sem vincular (manter oferta)</strong> para pular uma variação e continuar com as demais. Essa opção não exclui nem altera a oferta.</p><p *ngIf="!manualMode">Selecione o SKU Bling correto para cada variação abaixo. Sua escolha será usada mesmo quando os nomes das cores forem diferentes. Se não houver equivalente, selecione "Não existe correspondente na Bling" para revisar a exclusão.</p>
        <div class="remove-all-toolbar" *ngIf="missingRemovalRows.length"><span>{{missingRemovalRows.length}} oferta(s) sem correspondente na Bling</span><button mat-stroked-button color="warn" (click)="prepareAllMissing()" [disabled]="busy">Excluir todas sem correspondente na Bling</button></div>
        <article *ngFor="let row of manualRows;let rowIndex=index" class="manual-row">
          <div><strong>{{ row.mlb }}</strong><small *ngIf="row.variationId">Variação {{ row.variationId }}</small><span>Cor: {{ row.color || 'Não informada' }} · Tamanho: {{ row.size || 'Não informado' }}</span><small>SKU atual: {{ row.before || 'Sem SKU' }}</small><p class="absent-warning" *ngIf="missingSize(row)" role="alert"><mat-icon>warning_amber</mat-icon>{{row.warning || missingSizeWarning(row)}}</p><small *ngIf="!row.size">O anúncio não informa tamanho. Confirme a cor e o tamanho da variação Bling escolhida.</small></div>
          <div class="missing-row-actions" *ngIf="canRemove(row)"><strong>Sem correspondente na Bling</strong><button mat-stroked-button color="warn" (click)="prepareRemoval(row)" [disabled]="busy">{{row.variationId?'Excluir variação do Mercado Livre':'Excluir anúncio do Mercado Livre'}}</button></div><mat-form-field appearance="outline"><mat-label>Variação na Bling</mat-label><mat-select [attr.aria-label]="'Variação na Bling para '+row.mlb" [formControl]="row.control" [disabled]="busy || finished" (selectionChange)="selectionChanged()"><mat-option [value]="leaveUnlinked">Deixar sem vincular (manter oferta)</mat-option><mat-option *ngIf="!manualMode" [value]="noCorrespondence">Não existe correspondente na Bling</mat-option><mat-option *ngIf="!optionsFor(row).length" disabled>Nenhuma variação Bling com tamanho compatível.</mat-option><mat-option *ngFor="let option of optionsFor(row)" [value]="option.sku"><ng-container *ngIf="option.parentSku">{{option.parentSku}} · </ng-container>{{ option.sku }} · {{ option.color || 'Sem cor' }} · {{ option.size || 'Sem tamanho' }}</mat-option></mat-select></mat-form-field>
        </article>
      </section>
      <section *ngIf="manualProposal" class="manual-review"><p *ngIf="manualProposal.skipped?.length">{{manualProposal.skipped.length}} oferta(s) será(ão) deixada(s) sem novo vínculo, sem alterar o Mercado Livre.</p><h3>Confira os vínculos manuais</h3><p>Nenhuma alteração foi aplicada. Confira os SKUs antes de confirmar.</p><table><thead><tr><th>Anúncio / variação</th><th>Cor / tamanho</th><th>SKU anterior</th><th>SKU pai</th><th>SKU escolhido</th></tr></thead><tbody><tr *ngFor="let row of manualProposal.rows"><td>{{row.mlb}} · {{row.variationId}}</td><td>{{row.color}} · {{row.size}}</td><td>{{row.before}}</td><td>{{row.parentSku}}</td><td><strong>{{row.sku}}</strong></td></tr></tbody></table><button mat-button (click)="manualProposal=undefined" [disabled]="busy">Voltar para editar</button></section><section class="removal-review" *ngIf="removal"><h3>Confirmar exclusão</h3><p><strong>{{removal.mlb}}</strong><span *ngIf="removal.variationId"> · Variação {{removal.variationId}}</span> · {{removal.color}} · {{removal.size}}</p><p>Na Bling, os tamanhos disponíveis são: {{removal.catalogSizes.join(', ')}}.</p><p>{{removal.message}} Esta ação não pode ser desfeita pelo Consultor.</p><button mat-button (click)="removal=undefined" [disabled]="busy">Cancelar exclusão</button><button mat-flat-button color="warn" (click)="confirmRemoval()" [disabled]="busy">Confirmar exclusão no Mercado Livre</button></section>
      <p *ngIf="removalMessage" role="status">{{removalMessage}}</p>
      <section class="removal-review" *ngIf="bulkRemoval.length"><h3>Confirmar exclusão de {{bulkRemoval.length}} oferta(s)</h3><p>Serão excluídas somente as ofertas abaixo, marcadas como sem correspondente na Bling. Esta ação não pode ser desfeita pelo Consultor.</p><table><thead><tr><th>MLB / variação</th><th>Cor</th><th>Tamanho</th></tr></thead><tbody><tr *ngFor="let row of bulkRemoval"><td>{{row.mlb}}<small *ngIf="row.variationId">{{row.variationId}}</small></td><td>{{row.color}}</td><td>{{row.size}}</td></tr></tbody></table><button mat-button (click)="bulkRemoval=[]" [disabled]="busy">Cancelar exclusão de todas</button><button mat-flat-button color="warn" (click)="confirmAllMissing()" [disabled]="busy">Confirmar exclusão das {{bulkRemoval.length}} ofertas no Mercado Livre</button></section>
      <section *ngIf="finished" role="status" class="completion" [class.partial]="!succeeded">
        <h3><mat-icon>{{ succeeded ? 'check_circle' : 'info' }}</mat-icon>{{ succeeded ? 'Vinculação concluída' : 'Vinculação concluída com pendências' }}</h3>
        <p>{{ result }}</p>
        <p *ngIf="linkedItems.length">O sistema foi atualizado com os vínculos abaixo.</p>
      </section>
      <div *ngIf="linkedItems.length" class="summary-scroll"><table>
        <thead><tr><th>Anúncio / variação</th><th>Cor</th><th>Tamanho</th><th>SKU anterior</th><th>SKU vinculado</th></tr></thead>
        <tbody><tr *ngFor="let item of linkedItems"><td>{{ item.mlb }}<small>{{ item.variationId }}</small></td><td>{{ item.color || 'Não informada' }}</td><td>{{ item.size || 'Não informado' }}</td><td>{{ item.before || 'Sem SKU' }}</td><td><strong>{{ item.sku }}</strong></td></tr></tbody>
      </table></div>
      <section *ngIf="finished && succeeded" class="missing-variations">
        <p *ngIf="checkingMissing" role="status">Conferindo se há variações na Bling que faltam neste anúncio...</p>
        <mat-progress-bar *ngIf="checkingMissing" mode="indeterminate"></mat-progress-bar>
        <p *ngIf="missingError" role="alert">{{missingError}} <button mat-button (click)="checkMissing()">Tentar novamente</button></p>
        <ng-container *ngIf="missingRows.length && !missingDismissed">
          <h3><mat-icon>playlist_add</mat-icon>Há {{missingRows.length}} variação(ões) da Bling sem oferta neste anúncio</h3>
          <p>Deseja adicionar as variações que faltam? Você poderá escolher quais enviar e revisar os dados antes de confirmar.</p>
          <div class="summary-scroll"><table><thead><tr><th>SKU Bling</th><th>Cor</th><th>Tamanho</th></tr></thead><tbody><tr *ngFor="let row of missingRows"><td>{{row.sku}}</td><td>{{row.cor || 'Sem cor'}}</td><td>{{row.tamanho || 'Sem tamanho'}}</td></tr></tbody></table></div>
          <div class="missing-actions"><button mat-button (click)="missingDismissed=true">Agora não</button><button mat-flat-button color="primary" (click)="addMissing()"><mat-icon>playlist_add</mat-icon>Sim, escolher variações</button></div>
        </ng-container>
        <p *ngIf="missingDismissed && !checkingMissing" role="status">{{followupMessage || 'As variações faltantes não foram adicionadas. Você pode incluí-las depois em Adicionar variações.'}}</p>
      </section>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()" [disabled]="busy">{{ finished ? 'Fechar' : 'Cancelar' }}</button>
      <button mat-flat-button color="primary" *ngIf="!finished && !manualMode" (click)="apply()" [disabled]="busy || !!removal || !!bulkRemoval.length || parentSku.invalid || missingChoices">{{ busy ? 'Aplicando…' : 'Corrigir SKUs e vincular' }}</button>
      <button mat-stroked-button *ngIf="manualMode && !finished && !manualProposal" (click)="loadManual()" [disabled]="busy || parentSku.invalid">Carregar variações</button><button mat-flat-button color="primary" *ngIf="manualMode && !finished" (click)="manualProposal ? confirmManual() : reviewManual()" [disabled]="busy || parentSku.invalid || !manualRows.length || missingChoices">{{busy ? 'Processando...' : manualProposal ? 'Confirmar vínculos no Mercado Livre' : 'Revisar vínculos manuais'}}</button>
    </mat-dialog-actions>
  `,
  styles: [`.second-parent{margin-left:12px}.parent-hint{font-size:12px;color:#52657b;background:#edf6fc;border-radius:8px;padding:10px}@media(max-width:650px){.second-parent{margin-left:0}}.link-mode{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.link-mode button[aria-pressed=true]{background:#edf6fc;border-color:#07537b;color:#07537b}.manual-review{padding:16px;border:1px solid #c8e1ef;border-radius:10px;overflow:auto}.remove-all-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:12px;margin:14px 0;background:#fff7ed;border:1px solid #f4d49a;border-radius:9px}.remove-all-toolbar span{font-size:12px;color:#895100}.remove-all-toolbar button{white-space:normal;height:auto;min-height:40px}.missing-row-actions{flex:0 1 360px;display:grid;gap:10px;align-content:center;color:#895100;font-size:12px}.missing-row-actions button{white-space:normal;min-height:40px;height:auto;padding:8px 12px}.manual-row>div.missing-row-actions{flex:0 1 360px}@media(max-width:650px){.manual-row>div.missing-row-actions{flex:0 1 auto;width:100%}}.absent-warning{display:flex;gap:8px;align-items:flex-start;background:#fff5e5;border:1px solid #f4d49a;border-radius:8px;padding:10px;color:#895100;font-size:12px}.absent-warning mat-icon{flex-shrink:0}.removal-review{margin-top:20px;padding:16px;border:1px solid #e9b9b5;border-radius:10px;background:#fff5f4}.removal-review h3{margin-top:0}.missing-variations{margin-top:20px;padding:18px;border:1px solid #c9dfef;border-radius:12px;background:#f0f7fb}.missing-variations h3{display:flex;gap:8px;align-items:center;font-size:16px;margin:0}.missing-variations .summary-scroll{max-height:240px;background:white;border-radius:8px}.missing-actions{display:flex;justify-content:flex-end;gap:12px;flex-wrap:wrap;margin-top:16px}p{line-height:1.5}mat-progress-bar{margin:12px 0}.completion{padding:16px;background:#eefaf3;border:1px solid #a8dabc;border-radius:12px}.completion.partial{background:#fff8eb;border-color:#ecd09b}.completion h3{display:flex;align-items:center;gap:8px;margin:0}.summary-scroll{overflow:auto;margin-top:16px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:12px;text-align:left;border-bottom:1px solid #e4e7ec}td small{display:block}.manual-row{display:flex;align-items:center;gap:20px;border-top:1px solid #e4e7ec;padding-top:16px}.manual-row>div{display:grid;gap:5px;flex:1}.manual-row mat-form-field{width:360px;max-width:100%}small{color:#697386}@media(max-width:650px){.manual-row{flex-direction:column;align-items:stretch}}`]
})
export class SkuLinkDialogComponent implements OnDestroy {
  manualMode=false;
  secondParentSku=new FormControl('',{nonNullable:true});
  manualProposal:any;
  setManual(value:boolean){if(this.busy)return;this.manualMode=value;this.resetChoices();}
  private async manualRequest(work:()=>Promise<void>){
    if(this.busy||this.finished||this.parentSku.invalid||!this.contextValid())return;
    this.busy=true;this.ref.disableClose=true;this.error='';
    try{await work();}catch(error){this.error=this.message(error);}finally{this.busy=false;this.ref.disableClose=false;}
  }
  async loadManual(){
    if(!this.manualMode)return;
    await this.manualRequest(async()=>{
      const value=await firstValueFrom(this.api.post<any>('/listing-links/sku/manual-options',{reference:this.data.reference,parentSku:this.parentSku.value.trim(),parentSkus:this.secondParentSku.value.trim()?[this.secondParentSku.value.trim()]:[]}).pipe(takeUntil(this.destroyed)));
      if(!this.contextValid())return;
      this.manualProposal=undefined;this.manualOptions=value.options;
      this.manualRows=value.rows.map((row:any)=>({...row,control:new FormControl(row.interactionBlocked?this.leaveUnlinked:'',{nonNullable:true})}));
    });
  }
  async reviewManual(){
    if(!this.manualMode||!this.manualRows.length||this.missingChoices)return;
    await this.manualRequest(async()=>{
      const proposal=await firstValueFrom(this.api.post<any>('/listing-links/sku/preview',{reference:this.data.reference,parentSku:this.parentSku.value.trim(),manual:true,choices:this.selectedChoices(),skipped:this.skippedChoices()}).pipe(takeUntil(this.destroyed)));
      if(this.contextValid())this.manualProposal=proposal;
    });
  }
  async confirmManual(){
    if(!this.manualMode||!this.manualProposal)return;
    await this.manualRequest(async()=>{
      const value=await firstValueFrom(this.api.post<any>('/listing-links/sku/'+this.manualProposal.id+'/confirm').pipe(takeUntil(this.destroyed)));
      this.manualProposal=undefined;this.result=value.message;this.succeeded=value.success;this.linkedItems=value.linkedItems??[];this.finished=true;this.changed=true;this.data.onUpdated?.();if(this.succeeded&&!value.skipped)this.checkMissing();
    });
  }
  bulkRemoval:any[]=[];
  readonly noCorrespondence = '__NO_CORRESPONDENCE__';
  readonly leaveUnlinked='__LEAVE_UNLINKED__';
  selectedChoices(){return this.manualRows.filter(row=>row.control.value!==this.leaveUnlinked).map(row=>({mlb:row.mlb,variationId:row.variationId,sku:row.control.value.trim(),parentSku:this.manualOptions.find(option=>option.sku===row.control.value.trim())?.parentSku||this.parentSku.value.trim()}));}
  skippedChoices(){return this.manualRows.filter(row=>row.control.value===this.leaveUnlinked).map(row=>({mlb:row.mlb,variationId:row.variationId}));}
  selectionChanged(){this.manualProposal=undefined;this.removal=undefined;this.bulkRemoval=[];this.removalMessage='';this.error='';}
  canRemove(row:any){return row.control.value!==this.leaveUnlinked&&(this.missingSize(row)||row.control.value===this.noCorrespondence);}
  get missingRemovalRows(){return this.manualRows.filter(row=>this.canRemove(row));}
  async prepareAllMissing(){
    if(this.busy||!this.missingRemovalRows.length||!this.contextValid())return;
    this.busy=true;this.ref.disableClose=true;this.error='';this.removal=undefined;this.bulkRemoval=[];
    const rows=[...new Map(this.missingRemovalRows.map(row=>[row.mlb+':'+(row.variationId||''),row])).values()];const reviews:any[]=[];
    try{for(const [i,row] of rows.entries()){if(!this.contextValid())return;this.removalMessage='Conferindo exclusão '+(i+1)+' de '+rows.length+'…';reviews.push(await firstValueFrom(this.api.post<any>('/listing-links/sku/missing-removal/prepare',{reference:this.data.reference,parentSku:this.parentSku.value.trim(),mlb:row.mlb,variationId:row.variationId||'',noCorrespondence:row.control.value===this.noCorrespondence})));}this.bulkRemoval=reviews;this.removalMessage='Confira todas as ofertas antes de confirmar a exclusão.';}
    catch(error){this.error=this.message(error);this.removalMessage='Nenhuma exclusão foi enviada. Resolva a falha e confira novamente.';}
    finally{this.busy=false;this.ref.disableClose=false;}
  }
  async confirmAllMissing(){
    if(this.busy||!this.bulkRemoval.length||!this.contextValid())return;
    const reviews=[...this.bulkRemoval];const previousByMlb=new Map<string,string>();let completed=0;this.busy=true;this.ref.disableClose=true;this.error='';
    try{for(const [i,review] of reviews.entries()){if(!this.contextValid())throw new Error('A conta selecionada mudou.');this.removalMessage='Excluindo oferta '+(i+1)+' de '+reviews.length+'…';const value:any=await firstValueFrom(this.api.post('/listing-links/sku/missing-removal/'+review.id+'/confirm',{previousReviewId:previousByMlb.get(review.mlb)}));if(!value.success)throw {error:{message:value.message}};previousByMlb.set(review.mlb,review.id);this.manualRows=this.manualRows.filter(row=>!(row.mlb===value.mlb&&(row.variationId||'')===(value.variationId||'')));completed++;this.changed=true;}}
    catch(error){this.error=this.message(error);}
    finally{this.bulkRemoval=[];this.removalMessage=completed+' de '+reviews.length+' exclusão(ões) confirmada(s).'+(completed<reviews.length?' O envio foi interrompido; confira as ofertas restantes antes de tentar novamente.':'');this.busy=false;this.ref.disableClose=false;if(completed)this.data.onUpdated?.();}
  }
  removal:any;removalMessage='';
  async prepareRemoval(row:any){if(this.busy||!this.contextValid())return;this.busy=true;this.ref.disableClose=true;this.error='';this.bulkRemoval=[];try{this.removal=await firstValueFrom(this.api.post<any>('/listing-links/sku/missing-removal/prepare',{reference:this.data.reference,parentSku:this.parentSku.value.trim(),mlb:row.mlb,variationId:row.variationId||'',noCorrespondence:row.control.value===this.noCorrespondence}));}catch(error){this.error=this.message(error);}finally{this.busy=false;this.ref.disableClose=false;}}
  async confirmRemoval(){if(this.busy||!this.removal||!this.contextValid())return;this.busy=true;this.ref.disableClose=true;this.error='';try{const value:any=await firstValueFrom(this.api.post('/listing-links/sku/missing-removal/'+this.removal.id+'/confirm',{}));this.removalMessage=value.message;if(value.success){this.manualRows=this.manualRows.filter(row=>!(row.mlb===value.mlb&&(row.variationId||'')===(value.variationId||'')));this.removal=undefined;this.changed=true;this.data.onUpdated?.();}else{this.error=value.message;this.removal=undefined;}}catch(error){this.error=this.message(error);}finally{this.busy=false;this.ref.disableClose=false;}}
  checkingMissing=false;missingRows:any[]=[];missingError='';missingDismissed=false;followupMessage='';
  private readonly destroyed=new Subject<void>();
  parentSku = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/)] });
  busy = false;
  error = '';
  result = '';
  finished = false;
  changed = false;
  succeeded = false;
  linkedItems: Array<{ mlb: string; variationId: string | null; color: string; size: string; before: string; sku: string }> = [];
  manualRows: any[] = [];
  manualOptions: Array<{sku: string; color: string | null; size: string | null;parentSku?:string}> = [];
  get missingChoices() { return this.manualRows.some(row => !row.control.value || this.canRemove(row)); }
  resetChoices() { this.manualProposal=undefined; this.bulkRemoval=[];this.removal=undefined;this.removalMessage='';this.manualRows = []; this.manualOptions = []; this.error = ''; }
  private readonly accountId = localStorage.getItem('selectedMarketplaceAccountId');
  missingSize(row:any){return row.missingInBling===true||!!equivalentSize(row.size||'')&&this.manualOptions.length>0&&!this.optionsFor(row).length;}
  missingSizeWarning(row:any){return 'O tamanho '+row.size+' não existe na grade deste produto na Bling.';}
  optionsFor(row:any){const size=equivalentSize(row.size||'');return this.manualOptions.filter(option=>!String(row.size??'').trim()||!!size&&equivalentSize(option.size||'')===size).sort((a,b)=>(a.color??'').localeCompare(b.color??'','pt-BR',{sensitivity:'base'})||compareSizes(a.size??'',b.size??''));}
  constructor(private readonly api: ApiService, private readonly ref: MatDialogRef<SkuLinkDialogComponent>,private readonly dialog:MatDialog, @Inject(MAT_DIALOG_DATA) readonly data: { batchProgress?:BatchProgress; reference: string; title: string; parentSku?:string; onUpdated?: () => void }) {if(data.parentSku)this.parentSku.setValue(data.parentSku);}
  checkMissing(){
    if(this.checkingMissing||!this.succeeded||!this.contextValid())return;
    this.checkingMissing=true;this.missingError='';
    this.api.get<any>('/chat/listing-variations',{reference:this.data.reference}).pipe(takeUntil(this.destroyed)).subscribe({next:catalog=>{this.missingRows=catalog.rows.filter((row:any)=>row.available).sort((a:any,b:any)=>(a.cor??'').localeCompare(b.cor??'','pt-BR',{sensitivity:'base'})||compareSizes(a.tamanho??'',b.tamanho??''));this.checkingMissing=false;},error:()=>{this.checkingMissing=false;this.missingError='Os vínculos foram salvos, mas não foi possível conferir as variações faltantes agora.';}});
  }
  addMissing(){
    if(!this.missingRows.length||!this.contextValid())return;
    this.ref.disableClose=true;
    this.dialog.open(AddVariationsDialogComponent,{data:{reference:this.data.reference,title:this.data.title,initialSkus:this.missingRows.map(row=>row.sku),batchProgress:this.data.batchProgress,onUpdated:()=>this.data.onUpdated?.()},width:'1150px',maxWidth:'97vw',maxHeight:'94vh'}).afterClosed().pipe(takeUntil(this.destroyed)).subscribe(result=>{
      this.ref.disableClose=false;this.data.onUpdated?.();
      if(result?.completed){this.missingDismissed=true;this.followupMessage=result.message||'A solicitação de inclusão foi processada. Confira o resultado dos anúncios.';}
    });
  }
  private contextValid() {
    if (this.accountId && this.accountId === localStorage.getItem('selectedMarketplaceAccountId')) return true;
    this.error = 'A conta selecionada mudou. Feche e abra novamente esta janela.';
    return false;
  }
  apply() {
    if (this.busy || this.finished || this.removal || this.bulkRemoval.length || this.parentSku.invalid || this.missingChoices || !this.contextValid()) return;
    this.busy = true; this.ref.disableClose = true; this.error = ''; this.result = ''; this.finished = false;
    this.api.post<{ id: string }>('/listing-links/sku/preview', { reference: this.data.reference, parentSku: this.parentSku.value.trim(),parentSkus:this.secondParentSku.value.trim()?[this.secondParentSku.value.trim()]:[], choices:this.selectedChoices(),skipped:this.skippedChoices() }).pipe(
      switchMap(proposal => this.contextValid()
        ? this.api.post<any>('/listing-links/sku/' + proposal.id + '/confirm')
        : throwError(() => ({ error: { message: this.error } }))),takeUntil(this.destroyed)
    ).subscribe({
      next: value => { this.result = value.message; this.succeeded = value.success; this.linkedItems = value.linkedItems ?? []; this.finished = true; this.changed = true; this.busy = false; this.ref.disableClose = false; this.data.onUpdated?.();if(this.succeeded&&!value.skipped)this.checkMissing(); },
      error: error => {
        const details = error.error?.details;
        if (details?.code === 'SKU_MANUAL_SELECTION_REQUIRED') {
          const existing = this.manualRows.filter(row => row.control.value);
          this.manualRows = [...existing.filter(row => !details.rows.some((next: any) => next.mlb === row.mlb && next.variationId === row.variationId)), ...details.rows.map((row: any) => ({ ...row, control: new FormControl('', { nonNullable: true }) }))];
          this.manualOptions = details.options;
        }
        this.error = this.message(error); this.changed = true; this.busy = false; this.ref.disableClose = false;
      }
    });
  }
  close() { this.ref.close(this.finished ? { message: this.result,completed:true,success:this.succeeded } : this.changed); }
  private message(error: any) { return typeof error.error?.message === 'string' ? error.error.message : 'Não foi possível concluir. Verifique a conexão da conta e tente novamente.'; }
  ngOnDestroy(){this.destroyed.next();this.destroyed.complete();}
}
