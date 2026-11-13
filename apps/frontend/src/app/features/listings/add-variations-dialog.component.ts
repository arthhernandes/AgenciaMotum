import { BatchProgress, BatchProgressComponent } from './batch-progress.component';
import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Subject, Subscription, exhaustMap, takeUntil, timer } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';
import { compareSizes, equivalentSize } from './size-order';
import { CreateSizeChartDialogComponent } from './create-size-chart-dialog.component';

type CatalogRow = { sku: string; cor: string | null; tamanho: string | null; quantidadePublicavel: number | null; available: boolean; substituivelEmAnalise?:boolean;novaOfertaDisponivel?:boolean;pendenciaModeracao?:string;motivoModeracao?:string; cadastradaNaFamilia?:boolean; cadastrosSemOferta?:string[] };
@Component({
  selector: 'app-add-variations-dialog', standalone: true, imports: [...UI_IMPORTS, MatDialogModule, BatchProgressComponent],
  template: `
    <header class="dialog-heading"><span class="heading-icon"><mat-icon>playlist_add</mat-icon></span><div><small>CATÁLOGO BLING</small><h2 mat-dialog-title>Adicionar variações</h2></div></header>
    <app-batch-progress [progress]="data.batchProgress"></app-batch-progress>
    <mat-dialog-content>
      <p class="model-title">{{ data.title }}</p>
      <mat-progress-bar *ngIf="busy" mode="indeterminate"></mat-progress-bar>
      <p role="alert" class="error" *ngIf="error">{{ error }}</p>
      <ng-container *ngIf="catalog && !action && !finished">
        <p class="hint">Você pode incluir tamanhos faltantes de cores que já estão no anúncio. As opções começam desmarcadas; selecione as variações que deseja adicionar.</p><div class="mode-options">
          <button type="button" [class.active]="mode === 'all'" (click)="setMode('all')" [disabled]="busy"><mat-icon>done_all</mat-icon><strong>Todas as disponíveis</strong><small>Incluir {{ missingAvailable.length }} variações ausentes</small></button>
          <button type="button" [class.active]="mode === 'dropped'" (click)="setMode('dropped')" [disabled]="busy || !dropped.length"><mat-icon>restore</mat-icon><strong>Republicar variações indisponíveis</strong><small>Selecionar {{ dropped.length }} variações em análise ou inativas</small></button>
          <button type="button" [class.active]="mode === 'choose'" (click)="setMode('choose')" [disabled]="busy"><mat-icon>checklist</mat-icon><strong>Escolher variações</strong><small>Selecionar cores e tamanhos</small></button>
        </div>
        <p class="hint">Tamanhos com ofertas em análise ou inativas podem ser selecionados para tentar adicionar uma nova oferta, preservando as anteriores. Tamanhos com oferta ativa ou pausada ficam desabilitados. O Mercado Livre valida a inclusão e o estoque será consultado na Bling.</p>
<p class="hint">Cadastro sem oferta ainda não aparece como anúncio publicado. A aceitação de novas variações depende da validação do Mercado Livre.</p>
<div class="catalog-scroll"><table><thead><tr><th>Incluir</th><th>Cor / tamanho</th><th>SKU Bling</th><th>Estoque</th><th>Situação</th></tr></thead><tbody>
          <tr *ngFor="let row of visibleRows" [class.existing]="!row.available"><td><input type="checkbox" [checked]="selected.has(row.sku)" [disabled]="busy || !row.available || mode === 'all' && !row.substituivelEmAnalise && !row.novaOfertaDisponivel" (change)="toggle(row.sku)" [attr.aria-label]="'Selecionar SKU ' + row.sku"></td><td><strong>{{ row.cor || 'Sem cor' }}</strong><small>{{ row.tamanho || 'Sem tamanho' }}</small></td><td>{{ row.sku }}</td><td>{{ row.quantidadePublicavel ?? 'Não disponível' }}</td><td><span class="badge">{{ row.novaOfertaDisponivel ? 'Adicionar nova oferta, preservar anterior' : row.pendenciaModeracao ? 'Bloqueado pelo Mercado Livre' : row.substituivelEmAnalise ? 'Em análise — substituir oferta' : row.available ? 'Disponível para incluir' : 'Já no anúncio' }}</span><small *ngIf="row.cadastrosSemOferta?.length">Cadastro criado, sem oferta publicada: {{ row.cadastrosSemOferta?.join(', ') }}</small><small *ngIf="row.motivoModeracao">{{row.motivoModeracao}}</small></td></tr>
        </tbody></table></div>
        <p *ngIf="!available.length" class="empty">Nenhuma variação liberada para inclusão. Confira a situação de cada variação na lista.</p>
        <div class="settings" *ngIf="available.length">
          <mat-form-field appearance="outline"><mat-label>Preço das novas ofertas (R$)</mat-label><input matInput type="number" min="0.01" step="0.01" [formControl]="price" [readonly]="busy || !catalog.userProducts"><mat-hint>{{ catalog.userProducts ? 'Preço atual do modelo; ajuste se necessário.' : 'Anúncio tradicional: mantém o preço compartilhado.' }}</mat-hint></mat-form-field>
        </div>
        <p *ngIf="available.length && catalog.sizeChart?.status === 'NOT_APPLICABLE'" class="hint"><mat-icon inline>check_circle</mat-icon> Esta categoria não utiliza tabela de medidas. Você pode incluir as variações sem cadastrar um guia.</p>
        <p *ngIf="available.length && catalog.sizeChart?.status === 'SUPPORTED'" class="hint">Esta categoria aceita tabela de medidas. Se o modelo possuir uma tabela, ela será mantida. O Mercado Livre valida a exigência na publicação.</p>
        <section *ngIf="available.length && catalog.sizeChart?.supported !== false" class="size-chart-section">
          <header class="size-chart-header"><div><h3><mat-icon>straighten</mat-icon>Tabela de medidas</h3><p class="hint">Escolha o guia que será usado nas novas variações e confira as medidas abaixo.</p></div><button mat-stroked-button (click)="loadCharts()" [disabled]="busy || chartBusy || !selected.size"><mat-icon>{{ charts.length ? 'refresh' : 'search' }}</mat-icon>{{ chartBusy ? 'Consultando...' : charts.length ? 'Atualizar tabelas' : 'Buscar tabelas disponíveis' }}</button></header>
          <button mat-stroked-button class="create-chart-button" (click)="createChart()" [disabled]="busy || chartBusy || !selected.size"><mat-icon>add</mat-icon>Adicionar tabela — manual ou foto</button>
          <mat-progress-bar *ngIf="chartBusy" mode="indeterminate"></mat-progress-bar>
          <mat-form-field *ngIf="charts.length" appearance="outline" class="chart-selector"><mat-label>Selecione a tabela de medidas</mat-label><mat-select [formControl]="chartId" [disabled]="busy || chartBusy"><mat-option value="">Usar a tabela do anúncio modelo{{ modelChartName ? ' — ' + modelChartName : '' }}</mat-option><mat-option *ngFor="let chart of charts" [value]="chart.id" [disabled]="!chart.compatible">{{ chart.name }} · ID {{ chart.id }}{{ chart.compatible ? '' : ' — incompatível' }}</mat-option></mat-select></mat-form-field>
          <p *ngIf="!charts.length && !chartBusy" class="hint">Por padrão, será utilizada a tabela do anúncio modelo. Busque as tabelas para visualizar as medidas ou escolher outro guia.</p>
          <section *ngIf="selectedChart as chart" class="selected-chart" aria-live="polite">
            <div class="selected-chart-title"><div><small>GUIA SELECIONADO</small><h4>{{ chart.name }}</h4><p class="hint">ID {{ chart.id }} · {{ chart.type === 'STANDARD' ? 'Tabela padrão' : chart.type === 'BRAND' ? 'Tabela da marca' : 'Tabela do vendedor' }}</p></div><span class="chart-status" [class.incompatible]="!chart.compatible">{{ chart.compatible ? 'Compatível com a seleção' : 'Requer revisão' }}</span></div>
            <p *ngIf="!chart.compatible" class="error">{{ chart.reason }}</p>
            <div class="chart-size-tags"><span *ngFor="let size of chart.sizes">{{ size }}</span></div>
            <div *ngIf="chart.rows?.length" class="catalog-scroll measurement-table"><table><thead><tr><th>Tamanho</th><th *ngFor="let column of measurementColumns">{{ column }}</th><th *ngIf="!measurementColumns.length">Medidas</th></tr></thead><tbody><tr *ngFor="let row of chart.rows"><th>{{ row.size || 'Não informado' }}</th><td *ngFor="let column of measurementColumns">{{ measurementValue(row, column) }}</td><td *ngIf="!measurementColumns.length">Sem medidas adicionais informadas</td></tr></tbody></table></div>
            <p *ngIf="!chart.rows?.length" class="hint">Esta tabela não retornou linhas de medidas para exibição.</p>
          </section>
        </section>
        <p *ngIf="chartError" role="alert" class="error">{{ chartError }}</p>
      </ng-container>
      <section *ngIf="action && !finished" class="preview">
        <h3>Confira a inclusão de {{ selected.size }} variações</h3>
        <p *ngIf="selected.size > 20" class="hint">Confirme uma vez. O sistema envia as selecionadas em {{ variationBatchCount }} lotes de até 20 e verifica cada lote antes de continuar.</p>
        <p>As fotos e os dados do anúncio modelo serão reaproveitados. A confirmação autoriza a inclusão e, quando aplicável, a publicação das ofertas.</p>
        <p *ngIf="catalog?.userProducts">Variações sem saldo são publicadas pausadas e aguardam reposição. A publicação pode gerar tarifas do Mercado Livre.</p>
        <article *ngFor="let preview of action.preview"><h4>{{ preview.title }} · {{ preview.mlb }}</h4><div class="catalog-scroll"><table><tbody><tr *ngFor="let field of preview.fields"><th>{{ field.field }}</th><td>{{ field.before }}</td><td><strong>{{ field.after }}</strong></td></tr></tbody></table></div><p *ngFor="let note of preview.notes" class="hint">{{ note }}</p></article>
      </section>
      <section *ngIf="finished" class="completion" [class.waiting]="jobId && progress?.status !== 'COMPLETE'" role="status"><h3><mat-icon>{{ jobId ? (progress?.status === 'COMPLETE' ? 'check_circle' : 'info') : succeeded ? 'check_circle' : 'info' }}</mat-icon>{{ jobId ? (progress?.status === 'WAITING_DATA' ? 'Correção necessária no Mercado Livre' : 'Acompanhamento da publicação') : succeeded ? 'Inclusão concluída' : 'Inclusão com pendências' }}</h3><p>{{ result }}</p><mat-progress-bar *ngIf="jobId && progress" mode="determinate" [value]="progress.total ? progress.published / progress.total * 100 : 0"></mat-progress-bar><p *ngIf="progress?.batches">Lotes confirmados: {{ progress.batches.completed }} de {{ progress.batches.total }}</p><p *ngIf="progress">{{ progress.published }} de {{ progress.total }} publicadas · {{ progress.active }} ativas · {{ progress.withoutStock }} sem saldo</p><p *ngIf="jobId && (!progress || !['WAITING_DATA','FAILED','CANCELLED','COMPLETE'].includes(progress.status))" class="hint">O processamento continua no servidor se você fechar esta janela. A lista é atualizada conforme os resultados.</p><p *ngIf="progress?.status === 'WAITING_DATA'" class="hint">O envio foi interrompido e não continuará automaticamente. Corrija a pendência indicada e prepare uma nova prévia.</p></section>
    </mat-dialog-content>
    <mat-dialog-actions align="end"><span class="selection-count" *ngIf="!finished">{{ selected.size }} selecionadas</span><button mat-stroked-button *ngIf="finished && progress && ['WAITING_DATA','FAILED','CANCELLED'].includes(progress.status)" (click)="reviseSelection()" [disabled]="busy">Revisar seleção</button><button mat-button (click)="close()" [disabled]="busy">{{ finished ? 'Fechar' : 'Cancelar' }}</button><button mat-flat-button color="primary" *ngIf="!action && !finished" (click)="prepare()" [disabled]="busy || !selected.size || price.invalid">Preparar inclusão<mat-icon iconPositionEnd>arrow_forward</mat-icon></button><button mat-flat-button color="primary" *ngIf="action && !finished" (click)="confirm()" [disabled]="busy">{{ busy ? 'Processando...' : (action.confirmationLabel || 'Confirmar inclusão') }}</button></mat-dialog-actions>
  `,
  styles: [`.completion.waiting{background:#fff7e6;color:#76540d}.create-chart-button{margin-bottom:20px;border-radius:9px!important;min-height:38px}.size-chart-section{margin:12px 0 24px;padding:22px;background:#fff;border:1px solid #dce5ed;border-radius:14px;min-width:0}.size-chart-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:20px}.size-chart-header h3{display:flex;align-items:center;gap:8px;margin:0;color:#1d3448;font-size:16px}.size-chart-header p{margin:7px 0 0}.size-chart-header button{flex-shrink:0;min-height:38px;border-radius:9px;white-space:nowrap}.chart-selector{display:block;width:100%;margin-bottom:4px}.selected-chart{padding-top:16px;border-top:1px solid #edf0f4}.selected-chart-title{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.selected-chart-title small{font-size:10px;letter-spacing:1px;color:#667085}.selected-chart-title h4{margin:5px 0;font-size:16px;color:#1d2939;overflow-wrap:anywhere}.selected-chart-title p{margin:4px 0 0}.chart-status{font-size:11px;background:#e9f7ef;color:#177547;border-radius:20px;padding:6px 10px;white-space:nowrap}.chart-status.incompatible{background:#fff4e5;color:#99601a}.chart-size-tags{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0}.chart-size-tags span{padding:5px 11px;background:#edf4f9;color:#26516b;border-radius:7px;font-size:12px;font-weight:600}.measurement-table{max-height:320px}.measurement-table th,.measurement-table td{white-space:nowrap;padding:13px 16px}.measurement-table thead{position:sticky;top:0}.measurement-table tbody th{background:#f8fafc;color:#0d5275}.measurement-table tbody tr:nth-child(even){background:#fafcfe}.settings{margin-bottom:28px}.settings>mat-form-field{width:280px;max-width:100%}@media(max-width:700px){.create-chart-button{margin-bottom:20px;border-radius:9px!important;min-height:38px}.size-chart-section{padding:16px}.size-chart-header,.selected-chart-title{flex-direction:column;gap:12px}.size-chart-header button{width:100%}.chart-status{align-self:flex-start}}.dialog-heading{display:flex;align-items:center;gap:12px;padding:24px 24px 0}.dialog-heading h2{padding:0;margin:0}.dialog-heading small{color:#667085;font-size:10px;letter-spacing:1px}.heading-icon{display:grid;place-items:center;width:46px;height:46px;background:#e7f2f8;color:#0d5275;border-radius:14px}.model-title{font-weight:600}.mode-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0 12px}.mode-options button{display:grid;grid-template-columns:28px 1fr;text-align:left;gap:4px 10px;padding:16px;border:1px solid #dce2e9;border-radius:12px;background:#fff;color:#344054;cursor:pointer}.mode-options button.active{border-color:#0d5275;background:#edf6fb;box-shadow:0 0 0 1px #0d5275}.mode-options mat-icon{grid-row:span 2}.mode-options small{color:#667085}.catalog-scroll{overflow:auto;max-height:340px;border:1px solid #e4e7ec;border-radius:12px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:12px;border-bottom:1px solid #edf0f4}thead{background:#f8fafc}td small{display:block;color:#667085;margin-top:4px}input[type=checkbox]{width:17px;height:17px;accent-color:#0d5275}.existing{opacity:.6}.badge{font-size:11px;white-space:nowrap}.settings{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:22px 0}.settings>div{display:grid;gap:8px}.hint{color:#667085;font-size:12px;line-height:1.6}.error{color:#b42318}.selection-count{margin-right:auto;font-size:12px;color:#667085}.completion{padding:18px;background:#eef7f2;border-radius:12px}.completion h3{display:flex;align-items:center;gap:8px}.preview article{margin-top:20px}.empty{padding:16px;background:#eef7f2;border-radius:10px}@media(max-width:600px){.mode-options{grid-template-columns:1fr}.settings{display:block}.settings mat-form-field{width:100%}}`]
})
export class AddVariationsDialogComponent implements OnInit, OnDestroy {
  catalog: any; action: any; busy = false; error = ''; chartError = ''; chartBusy = false; charts: any[] = [];
  mode: 'all' | 'choose' | 'dropped' = 'choose'; selected = new Set<string>();
  price = new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]);
  chartId = new FormControl('', {nonNullable:true});
  modelChartId = '';
  get modelChartName(): string { return this.charts.find(chart=>chart.id===this.modelChartId)?.name ?? ''; }
  get selectedChart(): any {
    const chart = this.charts.find(chart=>chart.id===(this.chartId.value || this.modelChartId));
    const required=this.available.filter(row=>this.selected.has(row.sku)).map(row=>row.tamanho).filter((size):size is string=>!!size);
    const covers=!!chart&&required.every(size=>!!equivalentSize(size)&&(chart.sizes??chart.rows?.map((row:any)=>row.size)??[]).some((available:string)=>equivalentSize(available)===equivalentSize(size)));
    return chart ? {...chart, compatible:chart.compatible!==false&&covers, sizes:[...(chart.sizes??[])].sort(compareSizes), rows:[...(chart.rows??[])].sort((a:any,b:any)=>compareSizes(a.size,b.size))} : undefined;
  }
  get measurementColumns(): string[] { return [...new Set<string>((this.selectedChart?.rows ?? []).flatMap((row:any)=>(row.measurements ?? []).map((measurement:any)=>measurement.name)))]; }
  measurementValue(row:any, name:string): string { return (row.measurements ?? []).filter((measurement:any)=>measurement.name===name).map((measurement:any)=>measurement.value).filter(Boolean).join(' / ') || '—'; }
  finished = false; succeeded = false; result = ''; jobId = ''; progress: any;
  private accountId = localStorage.getItem('selectedMarketplaceAccountId');
  private readonly destroyed = new Subject<void>(); private polling?: Subscription;
  constructor(private readonly api: ApiService, private readonly ref:MatDialogRef<AddVariationsDialogComponent>, private readonly dialog: MatDialog, @Inject(MAT_DIALOG_DATA) readonly data: { batchProgress?:BatchProgress;reference:string;title:string;initialSkus?:string[];onUpdated:()=>void}) {}
  createChart(){
    if(this.busy||!this.selected.size||!this.validContext())return;
    const sizes=[...new Set(this.available.filter(row=>this.selected.has(row.sku)).map(row=>row.tamanho).filter((size):size is string=>!!size))].sort(compareSizes);
    this.dialog.open(CreateSizeChartDialogComponent,{data:{reference:this.data.reference,title:this.data.title,sizes},width:'1200px',maxWidth:'97vw',maxHeight:'94vh'}).afterClosed().pipe(takeUntil(this.destroyed)).subscribe(chart=>{if(chart&&this.validContext()){this.charts=[...this.charts.filter(existing=>existing.id!==chart.id),chart];this.chartId.setValue(chart.id);this.chartError='';}});
  }
  get visibleRows(): CatalogRow[] { return this.mode==='dropped'?this.dropped:(this.catalog?.rows ?? []); }
  get variationBatchCount():number { return Math.ceil(this.selected.size/20); }
  get available(): CatalogRow[] { return (this.catalog?.rows ?? []).filter((row:CatalogRow)=>row.available); }
  get dropped(): CatalogRow[] { return this.available.filter(row=>row.novaOfertaDisponivel===true); }
  get missingAvailable(): CatalogRow[] { return this.available.filter(row=>!row.substituivelEmAnalise&&!row.novaOfertaDisponivel); }
  ngOnInit() {
    if(!this.validContext())return;
    this.setBusy(true);
    this.api.get<any>('/chat/listing-variations',{reference:this.data.reference}).pipe(takeUntil(this.destroyed)).subscribe({next:catalog=>{this.catalog={...catalog,rows:[...catalog.rows].sort((a:CatalogRow,b:CatalogRow)=>(a.cor??'').localeCompare(b.cor??'','pt-BR',{sensitivity:'base'})||compareSizes(a.tamanho??'',b.tamanho??''))};this.price.setValue(catalog.price);this.setMode('choose');this.setBusy(false);},error:error=>{this.error=this.message(error);this.setBusy(false);}});
  }
  setMode(mode:'all'|'choose'|'dropped'){this.mode=mode;this.selected=new Set((mode==='all'?this.missingAvailable:mode==='dropped'?this.dropped:[]).map(row=>row.sku));}
  toggle(sku:string){if(this.selected.has(sku))this.selected.delete(sku);else this.selected.add(sku);}
  loadCharts(){
    if(!this.validContext()||this.chartBusy)return;
    this.chartBusy=true;this.chartError='';
    const sizes=[...new Set(this.available.filter(row=>this.selected.has(row.sku)).map(row=>row.tamanho).filter(Boolean))].join(',');
    this.api.get<any>('/chat/size-charts',{anuncio:this.data.reference,sizes}).pipe(takeUntil(this.destroyed)).subscribe({next:value=>{this.charts=value.charts;this.modelChartId=value.currentChartId??'';this.chartBusy=false;if(!this.charts.length)this.chartError='Nenhuma tabela disponível. Cadastre uma tabela de medidas pelo Assistente IA.';},error:error=>{this.chartError=this.message(error);this.chartBusy=false;}});
  }
  prepare(){
    if(this.busy||!this.selected.size||this.price.invalid||!this.validContext())return;
    this.setBusy(true);this.error='';
    this.api.post<any>('/chat/listing-variations/prepare',{reference:this.data.reference,skus:[...this.selected],...(this.catalog.userProducts?{price:this.price.value}:{}),...((this.chartId.value||this.modelChartId)?{sizeChartId:this.chartId.value||this.modelChartId}:{})}).pipe(takeUntil(this.destroyed)).subscribe({next:value=>{this.action=value.actions?.[0];if(!this.action)this.error='Nenhuma inclusão foi preparada.';this.setBusy(false);},error:error=>{this.error=this.message(error);this.setBusy(false);}});
  }
  confirm(){
    if(this.busy||!this.action||!this.validContext())return;
    this.setBusy(true);this.error='';
    this.api.post<any>('/chat/actions/'+this.action.id+'/confirm').pipe(takeUntil(this.destroyed)).subscribe({next:value=>{this.result=value.message;this.succeeded=value.success!==false;this.finished=true;this.jobId=value.publicationJobId??'';this.setBusy(false);this.data.onUpdated();if(this.jobId)this.watch();},error:error=>{this.error=this.message(error);this.finished=true;this.result='Não foi possível confirmar o resultado. Confira os anúncios antes de repetir a inclusão.';this.setBusy(false);this.data.onUpdated();}});
  }
  reviseSelection(){
    if(this.busy||!this.progress||!['WAITING_DATA','FAILED','CANCELLED'].includes(this.progress.status)||!this.validContext())return;
    this.polling?.unsubscribe();this.action=undefined;this.finished=false;this.succeeded=false;this.result='';this.jobId='';this.progress=undefined;this.catalog=undefined;this.error='';this.selected.clear();this.mode='choose';this.chartId.setValue('');this.charts=[];this.modelChartId='';this.chartError='';this.setBusy(false);this.data.onUpdated();this.ngOnInit();
  }
  private watch(){
    this.polling=timer(0,5000).pipe(exhaustMap(()=>this.api.get<any>('/chat/publications/'+this.jobId)),takeUntil(this.destroyed)).subscribe({next:value=>{this.progress=value;this.result=value.message;this.data.onUpdated();if(['COMPLETE','FAILED','CANCELLED','WAITING_DATA'].includes(value.status)){this.succeeded=value.status==='COMPLETE';this.polling?.unsubscribe();}},error:error=>{this.error='O acompanhamento foi interrompido. '+this.message(error);}});
  }
  close(){if(this.busy)return;if(this.action&&!this.finished&&this.validContext())this.api.post('/chat/actions/'+this.action.id+'/cancel').subscribe({error:()=>{}});this.ref.close({completed:this.finished,success:this.succeeded&&(!this.jobId||this.progress?.status==='COMPLETE'),message:this.result});}
  private setBusy(value:boolean){this.busy=value;this.ref.disableClose=value||!!this.action&&!this.finished;}
  private validContext(){if(this.accountId&&this.accountId===localStorage.getItem('selectedMarketplaceAccountId'))return true;this.error='A conta mudou. Feche e abra esta janela novamente.';return false;}
  private message(error:any){return typeof error.error?.message==='string'?error.error.message:'Não foi possível concluir. Confira a conexão e tente novamente.';}
  ngOnDestroy(){this.destroyed.next();this.destroyed.complete();this.polling?.unsubscribe();}
}
