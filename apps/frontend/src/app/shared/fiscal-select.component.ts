import {Component,EventEmitter,Input,Output} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FISCAL_OPTIONS} from './fiscal-options';

@Component({selector:'app-fiscal-select',standalone:true,imports:[CommonModule],template:`
 <select [value]="custom ? '__custom__' : value || ''" (change)="select($any($event.target).value)" [disabled]="disabled" [attr.aria-label]="label">
   <option value="" [selected]="!value && !custom">Selecione</option>
   <option *ngIf="value && !known && !custom" [value]="value" [selected]="true">{{value}} — valor atual</option>
   <option *ngFor="let option of options" [value]="option.value" [selected]="!custom && option.value===value">{{option.label}}</option>
   <option *ngIf="field==='measurement_unit'" value="__custom__" [selected]="custom">Outra unidade...</option>
 </select>
 <input *ngIf="custom" [value]="value" (input)="valueChange.emit($any($event.target).value)" [disabled]="disabled" maxlength="30" placeholder="Informe a sigla da unidade" [attr.aria-label]="label+' personalizada'">
 <small *ngIf="field==='measurement_unit'">Selecione a unidade comercial usada no produto.</small>
`,styles:[`:host{display:block;min-width:0}select,input{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;padding:10px;border-radius:7px;min-height:40px;color:#172b40;background:#fff;font:inherit}select{cursor:pointer;text-overflow:ellipsis}select:disabled,input:disabled{cursor:default;background:#f8fafc}input{margin-top:8px}small{display:block;font-size:11px;line-height:1.5;color:#667085;margin-top:6px;font-weight:400}`]})
export class FiscalSelectComponent {
 @Input() field='';@Input() value='';@Input() label='';@Input() disabled=false;@Output() valueChange=new EventEmitter<string>();custom=false;
 get options(){return FISCAL_OPTIONS[this.field]??[];}
 get known(){return this.options.some(option=>option.value===this.value);}
 select(value:string){this.custom=value==='__custom__';if(this.custom)this.valueChange.emit('');else this.valueChange.emit(value);}
}
