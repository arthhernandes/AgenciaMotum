import { Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';
import { compareSizes } from './size-order';

@Component({selector:'app-sku-audit',standalone:true,imports:[...UI_IMPORTS],template:`
  <section class="audit">
    <div class="heading"><div><h3>Auditoria e comparação</h3><small>Dados do catálogo sincronizado. Estoque diferente é um alerta para conferência, sem ajuste automático.</small></div><button mat-stroked-button (click)="load()" [disabled]="busy">Atualizar análise</button></div>
    <mat-progress-bar *ngIf="busy" mode="indeterminate"></mat-progress-bar><p *ngIf="error" role="alert">{{error}}</p>
    <ng-container *ngIf="audit">
      <div class="metrics"><div><strong>{{audit.summary.variants}}</strong>Variações Bling</div><div><strong>{{audit.summary.covered}}</strong>Com oferta identificada</div><div><strong>{{audit.summary.missing}}</strong>Sem anúncio</div><div><strong>{{audit.summary.alerts}}</strong>Alertas</div></div>
      <div class="tabs"><button mat-button (click)="tab='comparison'">Comparação</button><button mat-button (click)="tab='alerts'">Alertas ({{audit.alerts.length}})</button><button mat-button (click)="tab='history'">Histórico ({{audit.history.length}})</button></div>
      <div *ngIf="tab==='comparison'" class="scroll"><table><thead><tr><th>Variação Bling</th><th>Estoque Bling</th><th>Oferta / SKU no ML</th><th>Cor / tamanho no ML</th><th>Estoque / preço ML</th><th>Conferência</th></tr></thead><tbody>
        <ng-container *ngFor="let row of audit.rows"><tr *ngFor="let offer of row.offers.length ? row.offers : [null]">
          <td><strong>{{row.sku}}</strong><small>{{row.color || 'Sem cor'}} · {{row.size || 'Sem tamanho'}}</small><small>Bling: {{row.updatedAt | date:'dd/MM/yy HH:mm'}}</small></td><td>{{row.stock}}</td>
          <td>{{offer?.reference || 'Sem anúncio'}}<small>{{offer ? (offer.sku || 'SKU ausente') : '—'}}</small><small *ngIf="offer">Sincronizado: {{offer.syncedAt ? (offer.syncedAt | date:'dd/MM/yy HH:mm') : 'Data não registrada'}}</small></td>
          <td>{{offer?.color || '—'}} · {{offer?.size || '—'}}</td><td>{{offer?.stock ?? '—'}}<small *ngIf="offer">{{offer.price | currency:'BRL'}} · {{offer.status}}</small></td><td><span [class.warning]="row.issues.length">{{row.issues.join(' · ') || 'Sem divergência identificada'}}</span></td>
        </tr></ng-container>
      </tbody></table><p *ngIf="audit.unmatched.length"><strong>{{audit.unmatched.length}} oferta(s) sem correspondência:</strong> <span *ngFor="let offer of audit.unmatched">{{offer.reference}} / {{offer.sku || 'sem SKU'}}; </span></p></div>
      <div *ngIf="tab==='alerts'" class="alerts"><p *ngIf="!audit.alerts.length">Nenhum problema identificado pelas regras atuais.</p><p *ngFor="let alert of audit.alerts"><span class="badge">{{alert.severity==='info'?'Conferir':'Atenção'}}</span> {{alert.reference}} {{alert.message}}</p></div>
      <div *ngIf="tab==='history'" class="history"><p>Últimos 100 registros de alterações disponíveis para este produto. Valores não registrados não podem ser reconstruídos.</p><p *ngIf="!audit.history.length">Nenhuma alteração registrada para os anúncios identificados.</p><details *ngFor="let entry of audit.history"><summary>{{entry.createdAt | date:'dd/MM/yyyy HH:mm'}} · {{entry.reference}} · {{entry.user}} · {{statusName(entry.status)}}</summary><div class="scroll"><table><thead><tr><th>Campo</th><th>Antes</th><th>Alteração enviada</th></tr></thead><tbody><tr *ngFor="let field of historyFields(entry)"><td>{{field.name}}</td><td>{{field.before}}</td><td>{{field.after}}</td></tr></tbody></table></div></details></div>
      <p class="footnote">Análise: {{audit.generatedAt | date:'dd/MM/yyyy HH:mm'}}. Preço e dados fiscais da Bling não estão disponíveis neste cadastro local; não são comparados.</p>
    </ng-container>
  </section>
`,styles:[`.audit{margin:20px 0;border:1px solid #dbe5ef;border-radius:12px;padding:18px}.heading{display:flex;justify-content:space-between;gap:14px;align-items:center}.heading h3{margin:0 0 6px}.heading small,.footnote{color:#667085;font-size:12px}.metrics{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.metrics div{background:#eef6fb;padding:12px;border-radius:9px;flex:1;min-width:120px;font-size:12px}.metrics strong{display:block;font-size:24px;color:#0d5275;margin-bottom:4px}.tabs{display:flex;flex-wrap:wrap;border-bottom:1px solid #e4e7ec;margin-bottom:12px}.scroll{overflow:auto;max-height:430px}table{border-collapse:collapse;width:100%;font-size:12px;min-width:860px}th,td{text-align:left;padding:12px;vertical-align:top;border-bottom:1px solid #e4e7ec}th{background:#f5f8fc;position:sticky;top:0}td small{display:block;color:#667085;margin-top:5px}.warning{color:#9a6700}.alerts,.history{max-height:430px;overflow:auto;font-size:13px}.alerts p{padding:12px;background:#fff9ed;border-radius:7px;line-height:1.6}.badge{font-weight:600;color:#926300}.history details{padding:12px;border-bottom:1px solid #e4e7ec}.history summary{cursor:pointer}.snapshots{display:flex;gap:16px}.snapshots>div{flex:1;min-width:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:#f5f8fc;padding:12px}.footnote{margin-bottom:0;line-height:1.5}`]})
export class SkuAuditComponent implements OnChanges,OnDestroy {
  @Input() sku=''; @Input() revision=0; audit:any;busy=false;error='';tab='comparison';private readonly destroyed=new Subject<void>();
  constructor(private readonly api:ApiService){}
  statusName(status:string){return ({VERIFIED:'Verificada',UNVERIFIED:'A conferir',PENDING:'Em processamento',FAILED:'Falhou',Registrado:'Registrado'} as any)[status]||status;}
  historyFields(entry:any){
    const names:Record<string,string>={sku:'SKU',price:'Preço',quantity:'Estoque',available_quantity:'Estoque',status:'Status',title:'Título',variations:'Variações',attributes:'Atributos',productId:'Produto vinculado',productVariantId:'Variação vinculada',listingId:'Anúncio vinculado',listingVariantId:'Variação do anúncio',matchType:'Tipo de vínculo'};
    const before={...entry.before,available_quantity:entry.before.available_quantity??entry.before.quantity};
    const keys=[...new Set([...Object.keys(before),...Object.keys(entry.after)])].filter(key=>key!=='quantity');
    return keys.map(key=>({name:names[key]||key,before:this.displayValue(before[key]),after:this.displayValue(entry.after[key])}));
  }
  private displayValue(value:any):string{
    if(value==null)return 'Não registrado';
    if(Array.isArray(value))return value.map(item=>typeof item==='object'?[(item.name||item.id||''),item.value_name||item.value_id||'',item.quantity!=null?'Estoque: '+item.quantity:'',item.available_quantity!=null?'Estoque: '+item.available_quantity:'',item.attributes?this.displayValue(item.attributes):'',item.combinations?this.displayValue(item.combinations):''].filter(Boolean).join(' · '):String(item)).join('; ')||'Nenhum';
    if(typeof value==='object')return 'Vínculo registrado';
    return ({active:'Ativo',paused:'Pausado',closed:'Encerrado',MANUAL:'Manual'} as any)[String(value)]||String(value);
  }
  ngOnChanges(){this.load();}
  load(){if(!this.sku||this.busy)return;this.busy=true;this.error='';this.api.post<any>('/listing-links/sku/audit',{sku:this.sku}).pipe(takeUntil(this.destroyed)).subscribe({next:value=>{this.audit={...value,rows:value.rows.sort((a:any,b:any)=>(a.color||'').localeCompare(b.color||'','pt-BR')||compareSizes(a.size||'',b.size||''))};this.busy=false;},error:()=>{this.error='Não foi possível carregar a auditoria. Tente atualizar a análise.';this.busy=false;}});}
  ngOnDestroy(){this.destroyed.next();this.destroyed.complete();}
}
