import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';
import { ListingPhotoPickerComponent } from './listing-photo-picker.component';
import { prepareListingPhoto } from './prepare-listing-photo';
import { compareSizes } from './size-order';

export function duplicationOfferCount(options:any){return new Set((options?.variants??[]).filter((v:any)=>v.selected).map((v:any)=>v.offerKey||v.key)).size;}
export function validDuplicationSelection(options:any){const rows=duplicationSelection(options);return !!rows?.length&&rows.every((r:any)=>r.photos.length>0&&r.photos.length<=12);}
export function duplicationSelection(options:any){return options?.variants?.filter((v:any)=>v.selected).map((v:any)=>({key:v.key,photos:v.pictures.map((p:any)=>p.id)}));}
@Component({selector:'app-duplication-variants',standalone:true,imports:[...UI_IMPORTS,FormsModule,ListingPhotoPickerComponent],template:`
 <section aria-label="Variações e fotos da cópia"><h3>Variações e fotos</h3><p>Selecione as cores e os tamanhos que deseja copiar. As alterações de fotos valem somente para as cópias.</p>
 <p *ngIf="loading">Consultando variações do anúncio…</p><p class="error" role="alert" *ngIf="error">{{error}}</p><button mat-button *ngIf="error && !loading" (click)="load()" [disabled]="busy">Tentar consultar novamente</button>
 <details class="excluded" *ngIf="excluded.length"><summary>{{excluded.length}} oferta(s) indisponível(is) para duplicação</summary><p *ngFor="let row of excluded"><strong>{{row.color || 'Sem cor'}} · {{row.size || 'Sem tamanho'}} · {{row.reference}}</strong><br>{{row.message}}</p></details>
 <details *ngFor="let group of groups"><summary>{{group.color}} · {{selected(group)}} de {{group.rows.length}} variações selecionadas</summary>
 <label class="check"><input type="checkbox" [checked]="selected(group)===group.rows.length" [indeterminate]="selected(group)>0 && selected(group)<group.rows.length" (change)="selectGroup(group,$any($event.target).checked)" [disabled]="busy || uploading">Selecionar todos os tamanhos de {{group.color}}</label>
 <div class="variant" *ngFor="let row of group.rows"><label class="check"><input type="checkbox" [(ngModel)]="row.selected" (ngModelChange)="changed.emit()" [disabled]="busy || uploading">{{row.size || 'Sem tamanho'}} · SKU {{row.sku || 'Não informado'}}</label><small>Origem: {{row.reference}}</small></div>
 <details *ngIf="selected(group)"><summary>Editar fotos de {{group.color}} · {{group.pictures.length}} fotos</summary><app-listing-photo-picker [pictures]="group.pictures" [busy]="busy || uploading" [uploadMessage]="group.uploadMessage || ''" [label]="'Adicionar fotos de '+group.color" (filesSelected)="upload(group,$event)" (picturesChange)="changed.emit()"></app-listing-photo-picker>
 <details *ngFor="let row of group.rows"><summary>{{row.size || 'Sem tamanho'}} · SKU {{row.sku}} · {{row.customPhotos?'Fotos próprias':'Usa fotos da cor'}}</summary><label class="check"><input type="checkbox" [checked]="row.customPhotos" (change)="custom(row,group,$any($event.target).checked)" [disabled]="busy || uploading">Usar fotos específicas deste tamanho</label><app-listing-photo-picker *ngIf="row.customPhotos" [pictures]="row.pictures" [busy]="busy || uploading" [uploadMessage]="row.uploadMessage || ''" [label]="'Adicionar fotos do SKU '+row.sku" (filesSelected)="upload(row,$event)" (picturesChange)="changed.emit()"></app-listing-photo-picker></details>
 </details></details><p *ngIf="message" role="status">{{message}}</p></section>
`,styles:[`section{margin:18px 0;padding:14px;background:#f7fafc;border:1px solid #dce5ef;border-radius:10px}h3{font-size:15px;margin:0}p,summary,.check{font-size:13px;line-height:1.5}details{border:1px solid #dce5ef;border-radius:8px;padding:12px;margin:10px 0;background:white}summary{cursor:pointer;color:#07537b;font-weight:600}.check{display:flex;align-items:center;gap:8px;margin:10px 0}.check input{width:17px;height:17px}.variant{padding:5px 10px;border-bottom:1px solid #e8eef3}small{color:#697386;font-size:11px}.error{color:#b42318}`]})
export class DuplicationVariantsComponent implements OnChanges,OnDestroy {
 @Input() reference='';@Input() destinationAccountId='';@Input() busy=false;
 @Output() loaded=new EventEmitter<any>();@Output() changed=new EventEmitter<void>();@Output() loadingChange=new EventEmitter<boolean>();
 excluded:any[]=[];groups:any[]=[];loading=false;uploading=false;error='';message='';private sequence=0;
 constructor(private api:ApiService){}
 ngOnChanges(changes:any){if(changes.reference||changes.destinationAccountId)queueMicrotask(()=>void this.load());}
 async load(){const seq=++this.sequence;this.groups=[];this.excluded=[];this.loaded.emit(undefined);if(!this.reference||!this.destinationAccountId)return;this.loading=true;this.loadingChange.emit(true);this.error='';try{
  const options:any=await firstValueFrom(this.api.post('/chat/listing-duplication/options',{reference:this.reference,count:1,destinationAccountId:this.destinationAccountId}));if(seq!==this.sequence)return;
  this.excluded=options.excluded??[];const groups=new Map<string,any>();for(const row of options.variants){row.selected=true;const color=row.color||'Cor não informada';let group=groups.get(color);if(!group){group={color,pictures:row.pictures,rows:[]};groups.set(color,group);}row.customPhotos=JSON.stringify(row.pictures.map((p:any)=>p.id))!==JSON.stringify(group.pictures.map((p:any)=>p.id));if(!row.customPhotos)row.pictures=group.pictures;group.rows.push(row);}
  this.groups=[...groups.values()].sort((a,b)=>a.color.localeCompare(b.color,'pt-BR'));for(const group of this.groups)group.rows.sort((a:any,b:any)=>compareSizes(a.size,b.size));this.loaded.emit(options);
 }catch(e:any){if(seq===this.sequence)this.error=e.error?.message||'Não foi possível consultar as variações.';}finally{if(seq===this.sequence){this.loading=false;this.loadingChange.emit(false);}}}
 selected(group:any){return group.rows.filter((r:any)=>r.selected).length;}
 selectGroup(group:any,value:boolean){group.rows.forEach((r:any)=>r.selected=value);this.changed.emit();}
 custom(row:any,group:any,value:boolean){row.customPhotos=value;row.pictures=value?group.pictures.map((p:any)=>({...p})):group.pictures;this.changed.emit();}
 async upload(target:any,files:File[]){if(this.busy||this.uploading)return;const seq=this.sequence;this.uploading=true;this.loadingChange.emit(true);this.error='';target.uploadMessage='Preparando fotos...';let current=0;try{for(const file of files){if(target.pictures.length>=12)throw new Error('Cada variação permite até 12 fotos.');target.uploadMessage='Preparando foto '+(++current)+' de '+files.length+': '+file.name;const photo=await prepareListingPhoto(file);target.uploadMessage='Enviando foto '+current+' de '+files.length+': '+file.name;const form=new FormData();form.append('file',photo,photo.name);const uploaded:any=await firstValueFrom(this.api.post('/chat/listing-creation/photos/upload',form));if(seq!==this.sequence)return;if(!target.pictures.some((p:any)=>p.id===uploaded.id))target.pictures.push(uploaded);}this.message='Fotos adicionadas. Confira a capa e a ordem.';this.changed.emit();}catch(e:any){this.error=e.error?.message||e.message;}finally{target.uploadMessage='';this.uploading=false;this.loadingChange.emit(false);}}
 ngOnDestroy(){this.sequence++;}
}
