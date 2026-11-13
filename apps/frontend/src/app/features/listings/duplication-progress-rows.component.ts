import { Component, Input, OnChanges } from '@angular/core';
import { UI_IMPORTS } from '../../shared/ui';
import { compareSizes } from './size-order';

@Component({selector:'app-duplication-progress-rows',standalone:true,imports:[...UI_IMPORTS],template:`
 <section *ngFor="let group of groups" class="color-group">
  <h4><span *ngIf="multipleCopies">Cópia {{group.copy+1}} · </span>{{group.color}} <small>{{group.entries.length}} variação(ões)</small></h4>
  <article *ngFor="let entry of group.entries"><div class="result"><strong class="size">{{entry.variant.size || 'Sem tamanho'}}</strong><strong>{{entry.row.mlb?'Criado: ':'Origem: '}}{{entry.row.mlb || entry.row.reference}}</strong><span class="status">{{stateLabel(entry.row.state)}}</span></div>
   <small>{{entry.variant.color || 'Sem cor'}} · {{entry.variant.size || 'Sem tamanho'}} · SKU {{entry.variant.sku || entry.row.sku || 'Não informado'}} · Origem: {{entry.variant.reference || entry.row.reference}}</small><small *ngIf="entry.row.message">{{entry.row.message}}</small>
  </article>
 </section>
`,styles:[`.color-group{border:1px solid #dce5ef;border-radius:9px;background:white;margin:14px 0;overflow:hidden}h4{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:#edf5fb;color:#07537b;font-size:14px;padding:12px 14px;margin:0}h4 small{margin-left:auto;font-weight:400}article{padding:12px 14px;border-top:1px solid #e5edf4}.result{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px}.size{min-width:32px;padding:4px 8px;text-align:center;background:#f0f5f9;border-radius:5px;color:#07537b}.status{color:#52657b}small{display:block;font-size:12px;line-height:1.6;color:#697386;margin-top:4px}`]})
export class DuplicationProgressRowsComponent implements OnChanges {
 @Input() rows:any[]=[];
 groups:any[]=[];multipleCopies=false;
 ngOnChanges(){
  const groups=new Map<string,any>();
  for(const row of this.rows??[])for(const variant of row.variants?.length?row.variants:[{}]){
   const copy=row.copy??0,color=variant.color?.trim()||'Cor não informada';
   const key=copy+':'+color.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
   if(!groups.has(key))groups.set(key,{copy,color,entries:[]});groups.get(key).entries.push({row,variant});
  }
  this.groups=[...groups.values()].sort((a,b)=>a.copy-b.copy||a.color.localeCompare(b.color,'pt-BR',{sensitivity:'base'}));
  for(const group of this.groups)group.entries.sort((a:any,b:any)=>compareSizes(a.variant.size||'',b.variant.size||'')||String(a.variant.sku||a.row.reference).localeCompare(String(b.variant.sku||b.row.reference),'pt-BR',{numeric:true}));
  this.multipleCopies=new Set(this.groups.map(g=>g.copy)).size>1;
 }
 stateLabel(value:string){return ({PENDING:'Aguardando criação',SENDING:'Criando oferta',VERIFYING:'Conferindo',SUCCESS:'Concluído',FAILED:'Falhou',UNVERIFIED:'Conferência necessária'} as any)[value]||value;}
}
