import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { Subject, catchError, of, switchMap, takeUntil, timer } from 'rxjs';
import { ApiService } from '../core/api.service';
import { UI_IMPORTS } from './ui';

@Component({selector:'app-ncm-search',standalone:true,imports:[...UI_IMPORTS,MatAutocompleteModule],template:`
  <div class="ncm-search"><input matInput [formControl]="query" [matAutocomplete]="suggestions" [attr.aria-label]="label" placeholder="Buscar código ou descrição do NCM" autocomplete="off"><mat-icon aria-hidden="true">search</mat-icon></div>
  <mat-autocomplete #suggestions="matAutocomplete" (optionSelected)="choose($event)" class="ncm-search-options">
    <mat-option *ngIf="loading" disabled>Consultando base NCM...</mat-option>
    <mat-option *ngIf="error" disabled>{{error}}</mat-option>
    <mat-option *ngFor="let entry of results" [value]="entry.code"><div class="ncm-option"><strong>{{entry.formattedCode || entry.code}}</strong><span>{{entry.fullDescription || entry.description}}</span></div></mat-option>
    <mat-option *ngIf="searched && !loading && !error && !results.length" disabled>Nenhum NCM encontrado. Tente outro termo.</mat-option>
    <mat-option *ngIf="results.length && total>results.length" disabled>{{results.length}} de {{total}} resultados. Refine a pesquisa.</mat-option>
  </mat-autocomplete>
  <small class="ncm-help">Pesquise por código ou palavras da descrição e selecione um resultado.</small>
  <small *ngIf="description" class="ncm-description">{{description}}</small>
`,styles:[`:host{display:block;min-width:0}.ncm-search{position:relative}.ncm-search input{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;padding:10px 38px 10px 12px;border-radius:7px;min-height:40px;color:#172b40;background:#fff;font:inherit}.ncm-search input:focus{outline:2px solid #217ca8;outline-offset:1px}.ncm-search mat-icon{position:absolute;right:10px;top:10px;width:20px;height:20px;font-size:20px;color:#667085;pointer-events:none}.ncm-help{display:block;margin-top:6px;color:#667085;font-size:11px;font-weight:400;line-height:1.5}.ncm-description{display:block;margin-top:8px;padding:10px;background:#f0f7fb;border-radius:7px;color:#344054;line-height:1.5;font-size:12px;font-weight:400}.ncm-option{padding:10px 0;white-space:normal;line-height:1.5}.ncm-option strong{display:block;color:#0d5275;font-size:13px}.ncm-option span{font-size:12px;color:#475467;overflow-wrap:anywhere}.mat-mdc-option{height:auto;min-height:52px}`]})
export class NcmSearchComponent implements OnInit,OnChanges,OnDestroy {
  @Input() value='';@Input() disabled=false;@Input() label='NCM';@Output() valueChange=new EventEmitter<string>();
  query=new FormControl('',{nonNullable:true});results:any[]=[];total=0;loading=false;searched=false;error='';description='';
  private lastEmitted:string|undefined;private readonly destroyed=new Subject<void>();
  constructor(private readonly api:ApiService){}
  ngOnChanges(changes:SimpleChanges){if(changes['value']&&this.value!==this.lastEmitted){this.query.setValue(this.value||'',{emitEvent:false});this.description='';}if(changes['disabled']){if(this.disabled)this.query.disable({emitEvent:false});else this.query.enable({emitEvent:false});}}
  ngOnInit(){this.query.valueChanges.pipe(switchMap(text=>{
    this.description='';this.results=[];this.total=0;this.error='';this.loading=false;this.searched=false;
    this.emit(/^[\d.\s]*$/.test(text)?text.replace(/[.\s]/g,''):'');
    const search=text.trim();if(search.length<2)return of(null);this.loading=true;this.searched=true;
    return timer(300).pipe(switchMap(()=>this.api.get<any>('/ncm',{search,limit:25})),catchError(()=>{this.error='Não foi possível consultar a base NCM. Digite novamente para tentar.';return of(null);}));
  }),takeUntil(this.destroyed)).subscribe(result=>{this.loading=false;this.results=result?.data??[];this.total=result?.pagination?.total??0;});}
  choose(event:MatAutocompleteSelectedEvent){const code=String(event.option.value);const entry=this.results.find(row=>row.code===code);this.query.setValue(code,{emitEvent:false});this.description=entry?.fullDescription||entry?.description||'';this.emit(code);}
  private emit(value:string){this.lastEmitted=value;this.valueChange.emit(value);}
  ngOnDestroy(){this.destroyed.next();this.destroyed.complete();}
}
