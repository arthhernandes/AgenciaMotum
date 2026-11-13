import { ListingVariationGridComponent } from './listing-variation-grid.component';
import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { UI_IMPORTS } from '../../shared/ui';
import { ApiService } from '../../core/api.service';
import { ListingFiscalDialogComponent } from './listing-fiscal-dialog.component';
import { SkuLinkDialogComponent } from './sku-link-dialog.component';
import { compareSizes } from './size-order';

export function listingPhoto(row:any):string {
  const url=row?.rawData?.pictures?.[0]?.secure_url||row?.rawData?.pictures?.[0]?.url||row?.rawData?.thumbnail||row?.photo||'';
  return /^https?:\/\//i.test(url)?url.replace(/^http:/i,'https:'):'';
}
@Component({standalone:true,imports:[...UI_IMPORTS,FormsModule,MatDialogModule,ListingVariationGridComponent],template:`
  <header class="heading"><div><small>DETALHES DO ANÚNCIO · {{model?.familyId || reference}}</small><h2 mat-dialog-title>{{model?.title || data.title}}</h2><small>Aberto pelo anúncio {{reference}}</small></div><button mat-icon-button (click)="close()" [disabled]="busy" aria-label="Fechar detalhes"><mat-icon>close</mat-icon></button></header>
  <mat-dialog-content>
    <mat-progress-bar *ngIf="busy" mode="indeterminate"></mat-progress-bar><p *ngIf="error" class="error" role="alert">{{error}}</p><button mat-stroked-button *ngIf="!model && !busy" (click)="load()">Consultar novamente</button>
    <section *ngIf="!model && !busy && error"><h3>Dados da última sincronização</h3><p class="muted">A edição estará disponível após consultar os dados atuais do Mercado Livre.</p><article *ngFor="let offer of cachedOffers"><strong>{{offer.title}}</strong><small>{{offer.itemId}} · {{offer.price | currency:'BRL'}} · Estoque {{offer.availableQuantity}} · {{statusLabel(offer.status)}}</small></article></section>
    <ng-container *ngIf="model && draft">
      <ng-container *ngIf="phase==='view' || phase==='edit'">
        <section class="summary"><img *ngIf="photo" [src]="photo" alt="Imagem do produto" (error)="photo=''">
          <div class="facts"><div><small>Conta</small><strong>{{model.account}}</strong></div><div><small>Anúncios na família</small><strong>{{model.offers.length}}</strong></div><div><small>Estoque disponível</small><strong>{{total('stock')}}</strong></div><div><small>Unidades vendidas</small><strong>{{total('sold')}}</strong></div></div>
        </section>
        <p class="notice" *ngIf="model.familyId">O título, as características e a descrição são compartilhados pelas variações. Você pode ajustar preços e fotos por cor.</p>
        
        <p class="notice" *ngIf="model.hasBlockedOffers">Ofertas finalizadas ou bloqueadas ficam somente para consulta. Você pode editar as demais. Título e características compartilhadas permanecem protegidos.</p><app-listing-variation-grid [offers]="draft.offers" [editable]="phase==='edit'" [busy]="busy || data.interactionBlocked" (editRequested)="beginEdit()" (processingChange)="photoBusy($event)" (linkSkuRequested)="linkSku($event)" (fiscalRequested)="fiscal($event)"></app-listing-variation-grid>
        <section class="description-section"><div class="section-heading"><h3>Descrição do anúncio</h3><button mat-stroked-button *ngIf="phase==='view'" appPermission="listings.manage" (click)="beginEdit()" [disabled]="busy || data.interactionBlocked">Editar descrição</button></div><p class="muted">Descrição geral para todas as cores e tamanhos deste anúncio. Texto simples, sem HTML.</p><p class="notice" *ngIf="descriptionMissing && !parentDescription">O Mercado Livre não retornou uma descrição para este anúncio. Você pode preencher o texto abaixo e revisar antes de enviar.</p><div *ngIf="phase==='view'" class="description-text">{{parentDescription || 'Sem descrição cadastrada.'}}</div><label *ngIf="phase==='edit'">Descrição<textarea [(ngModel)]="parentDescription" (ngModelChange)="updateParentDescription($event)" maxlength="10000" rows="12" [disabled]="busy || data.interactionBlocked" aria-label="Descrição do anúncio" placeholder="Digite a descrição do anúncio"></textarea><small>{{parentDescription.length}}/10.000 caracteres · Será aplicada a todas as variações ao confirmar.</small></label></section>
        <details class="management-tools" [open]="phase==='edit'"><summary>Informações do anúncio</summary><div class="section-heading"><h3>Dados do anúncio</h3><button mat-stroked-button *ngIf="phase==='view'" appPermission="listings.manage" (click)="phase='edit'" [disabled]="busy || data.interactionBlocked"><mat-icon>edit</mat-icon>Editar informações</button></div>
        <label class="name-field">Título do anúncio<input [(ngModel)]="draft.title" maxlength="120" [disabled]="phase!=='edit' || busy || model.hasBlockedOffers"></label>
        <div class="fields"><label *ngFor="let attribute of draft.attributes"><span>{{attribute.name}}<small *ngIf="!attribute.editable">Consulta</small></span><select *ngIf="attribute.options.length && attribute.editable;else plainInput" [value]="attribute.valueId || ''" (change)="chooseAttribute(attribute,$any($event.target).value)" [disabled]="phase!=='edit' || busy"><option value="">{{attribute.value || 'Selecione'}}</option><option *ngFor="let option of attribute.options" [value]="option.id">{{option.name}}</option></select><ng-template #plainInput><input [(ngModel)]="attribute.value" maxlength="300" [disabled]="phase!=='edit' || !attribute.editable || busy || model.hasBlockedOffers"></ng-template></label></div>
        
        </details>
        <section *ngIf="links.length"><h3>Produtos Bling vinculados</h3><div class="color-groups"><details class="color-group" *ngFor="let group of linkedColorGroups; trackBy: trackColor"><summary><mat-icon class="color-chevron">chevron_right</mat-icon><span>{{group.color}}<small>{{group.links.length}} {{group.links.length===1?'vínculo':'vínculos'}}</small></span></summary><div class="linked-items"><p *ngFor="let link of group.links"><strong>{{link.product?.title || 'Produto Bling'}}</strong><span *ngIf="link.productVariant" class="linked-variation">{{link.productVariant.size || 'Tamanho não informado'}}</span><small>SKU {{link.productVariant?.sku || link.product?.sku}}</small></p></div></details></div></section>
      </ng-container>
      <section *ngIf="phase==='review' && review"><h3>Confira as alterações</h3><p class="notice">Anúncios afetados: {{review.affected.join(' · ')}}</p><h4 *ngIf="review.shared.length">Dados compartilhados do pai</h4><div class="table-scroll" *ngIf="review.shared.length"><table><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody><tr *ngFor="let field of review.shared"><td>{{field.field}}</td><td class="review-value">{{field.before}}</td><td class="review-value">{{field.after}}</td></tr></tbody></table></div><article *ngFor="let offer of review.offers"><h4>{{offer.mlb}} · {{offer.title}}</h4><div class="table-scroll"><table><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody><tr *ngFor="let field of offer.fields"><td>{{field.field}}</td><td>{{field.before}}</td><td>{{field.after}}</td></tr></tbody></table></div><p *ngFor="let note of offer.notes" class="muted">{{note}}</p></article></section>
      <section *ngIf="phase==='done'" class="completion" role="status"><h3>{{succeeded?'Alterações concluídas':'Conferência necessária'}}</h3><p>{{result}}</p><p>Os dados compartilhados podem levar alguns instantes para aparecer em todas as variações.</p><button mat-stroked-button (click)="load()" [disabled]="busy || data.interactionBlocked">Atualizar detalhes</button></section>
    </ng-container>
  </mat-dialog-content>
  <mat-dialog-actions align="end"><button mat-button (click)="close()" [disabled]="busy">Fechar</button><button mat-button *ngIf="phase==='edit'" (click)="discardEdit()" [disabled]="busy || data.interactionBlocked">Descartar edição</button><button mat-flat-button color="primary" *ngIf="phase==='edit'" (click)="prepare()" [disabled]="busy || !validDraft">Revisar alterações</button><button mat-button *ngIf="phase==='review'" (click)="back()" [disabled]="busy || data.interactionBlocked">Voltar para editar</button><button mat-flat-button color="primary" *ngIf="phase==='review'" (click)="confirm()" [disabled]="busy || data.interactionBlocked">Confirmar alterações no Mercado Livre</button></mat-dialog-actions>
`,styles:[`.top-price{margin:20px 0;padding:16px;border:1px solid #dce5ef;border-radius:10px;background:white}.top-price .section-heading{margin:0 0 12px}.top-price h3{margin:0}.top-price>label{display:grid;gap:7px;margin:12px 0;font-size:13px}.current-price{display:block;margin-top:12px;color:#07537b;font-size:25px;font-variant-numeric:tabular-nums}.top-price-controls{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin-top:14px}.top-price-controls label{display:grid;gap:7px;max-width:220px;font-size:13px}.review-value{white-space:pre-wrap;overflow-wrap:anywhere}.description-section{margin:24px 0;padding:16px;border:1px solid #dce5ef;border-radius:10px;background:white}.description-section .section-heading{margin-top:0}.description-section h3{margin:0 0 12px}.description-section label{display:grid;gap:8px;font-size:13px;margin:12px 0}.description-text{white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;line-height:1.6;font-size:13px;color:#344054}textarea{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:12px;font:inherit;font-size:13px;line-height:1.6;resize:vertical}.management-tools{border:1px solid #dce5ef;border-radius:10px;padding:16px;margin:20px 0}.management-tools>summary{cursor:pointer;color:#07537b;font-size:14px;font-weight:600}.management-tools[open]>summary{margin-bottom:18px}.linked-items{padding:0 16px}.linked-items p{padding:14px 0;margin:0;border-bottom:1px solid #e4e7ec}.linked-items p:last-child{border-bottom:0}.linked-variation{display:block;margin:5px 0;color:#0b5277;font-size:13px;font-weight:600}.heading{display:flex;justify-content:space-between;gap:16px;padding:24px 24px 0}.heading h2{margin:0;padding:8px 0;font-size:22px;line-height:1.4}.heading>div{min-width:0}small,.muted,dt{color:#697386}small{display:block;font-size:12px;line-height:1.5}.summary{display:flex;gap:24px;margin:18px 0}.summary img{width:140px;height:140px;object-fit:contain;background:white;border-radius:12px}.facts{flex:1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-content:center}.facts strong{display:block;margin-top:5px}.notice{padding:14px;background:#edf6fc;color:#22536d;border-radius:10px;font-size:13px;line-height:1.6}.section-heading{display:flex;justify-content:space-between;align-items:center;margin-top:24px;gap:12px}h3{font-size:17px;margin:22px 0 14px}.name-field{display:grid;gap:8px}.fields,.offer-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:16px 0}.fields label,.offer-fields label{display:grid;gap:7px;font-size:13px;align-content:start}.fields label>span{display:flex;justify-content:space-between;gap:8px}input,select{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;background:#fff;color:#172b40;padding:11px;border-radius:8px;font:inherit;min-height:42px}input:disabled,select:disabled{background:#f6f8fb;color:#475467;opacity:1}.muted{font-size:12px;line-height:1.6}.bulk-price{padding:16px;border:1px solid #dce5ef;border-radius:10px;background:#fff}.bulk-price h4{margin:0}.bulk-price .muted{margin:6px 0 10px}.all-prices{margin:0 0 16px;background:#edf6fc}.color-price{margin:14px}.status-controls{margin-top:14px}.bulk-price-controls{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.bulk-price-controls label{display:grid;gap:7px;font-size:13px;max-width:280px;flex:1;min-width:180px}.color-photos{margin:14px;padding:16px;border:1px solid #dce5ef;border-radius:10px}.color-photos h4{margin:0}.color-photos label{display:grid;gap:6px;font-size:13px;margin:12px 0}.photo-grid{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px}.photo-grid>div{border:1px solid #dce5ef;border-radius:8px;padding:6px}.photo-grid img{width:125px;height:125px;object-fit:contain}.photo-grid small{text-align:center}.color-groups{display:grid;gap:12px}.color-group{border:1px solid #dce5ef;border-radius:12px;overflow:hidden;background:#fff}.color-group summary{display:flex;align-items:center;gap:10px;padding:16px;cursor:pointer;list-style:none;background:#f2f7fb;color:#0b5277;font-weight:600}.color-group summary::-webkit-details-marker{display:none}.color-group summary:focus-visible{outline:2px solid #0b5277;outline-offset:-3px}.color-group summary small{margin-top:3px;font-weight:400}.color-chevron{flex-shrink:0;transition:transform .15s}.color-group[open] .color-chevron{transform:rotate(90deg)}.offers{display:grid;gap:14px;padding:14px}.size-label{display:inline-block;margin-bottom:10px;padding:4px 10px;border-radius:6px;background:#edf6fc;color:#0b5277;font-size:12px;font-weight:600}.offers article{padding:18px;border:1px solid #dce5ef;background:#fff;border-radius:12px}.offer-heading{display:flex;justify-content:space-between;gap:12px}.offer-heading small{margin-top:6px}.offer-fields{grid-template-columns:repeat(3,minmax(0,1fr))}.offer-actions{display:flex;gap:8px;flex-wrap:wrap}.characteristics dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;font-size:12px}.characteristics dd{margin:6px 0}.completion{background:#edf7f1;border-radius:12px;padding:18px;margin-top:20px}.completion p{white-space:pre-line;line-height:1.6}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:12px;text-align:left;border-bottom:1px solid #e4e7ec}.error{color:#b42318}@media(max-width:650px){.summary{flex-direction:column}.summary img{align-self:center}.fields,.offer-fields,.characteristics dl{grid-template-columns:1fr}.section-heading{flex-wrap:wrap}}`]})
export class ListingDetailsComponent implements OnInit,OnDestroy {
  parentDescription='';
  get descriptionMissing(){return this.model?.offers?.every((offer:any)=>!offer.description?.trim());}
  initializeParentDescription(){this.parentDescription=this.model?.offers?.find((offer:any)=>offer.reference===this.reference&&offer.description?.trim())?.description||this.model?.offers?.find((offer:any)=>offer.description?.trim())?.description||'';}
  updateParentDescription(text:string){for(const offer of this.draft.offers)if(!offer.interactionBlocked)offer.description=text;}
  allColorsPrice:number|null=null;allPriceMessage='';allColorsStatus='';allStatusMessage='';
  colorGroups:any[]=[];
  model:any;draft:any;review:any;reference:string;photo='';error='';busy=false;phase:'view'|'edit'|'review'|'done'='view';result='';succeeded=false;selectedOffer='';changed=false;
  private readonly account=localStorage.getItem('selectedMarketplaceAccountId');private readonly destroyed=new Subject<void>();
  constructor(@Inject(MAT_DIALOG_DATA) public readonly data:any,private readonly api:ApiService,private readonly dialog:MatDialog,public readonly ref:MatDialogRef<ListingDetailsComponent>){this.reference=data.children?.[0]?.itemId||data.itemId;}
  photoBusy(value:boolean){this.setBusy(value);}
  ngOnInit(){this.load();}
  private validContext(){if(this.account&&this.account===localStorage.getItem('selectedMarketplaceAccountId'))return true;this.error='A conta mudou. Abra novamente os detalhes.';return false;}
  private setBusy(value:boolean){this.busy=value;this.ref.disableClose=value||this.phase==='review';}
  load(){if(this.busy||!this.validContext())return;this.setBusy(true);this.error='';this.api.get<any>('/chat/listing-editor',{reference:this.reference}).pipe(takeUntil(this.destroyed)).subscribe({next:value=>{this.model=value;this.data.interactionBlocked=value.offers.every((offer:any)=>offer.interactionBlocked);this.model.offers.sort((a:any,b:any)=>{const attr=(offer:any,id:string)=>(offer.attributes??[]).find((v:any)=>v.id===id)?.value_name||'';return attr(a,'COLOR').localeCompare(attr(b,'COLOR'),'pt-BR')||compareSizes(attr(a,'SIZE'),attr(b,'SIZE'));});this.draft=structuredClone(this.model);this.initializeParentDescription();this.groupOffers();this.photo=listingPhoto(value.offers[0]);this.phase='view';this.review=undefined;this.setBusy(false);},error:error=>{this.error=this.message(error);this.setBusy(false);}});}
  private attributeValue(offer:any,id:string):string {const attr=(offer.attributes??[]).find((value:any)=>value.id===id);return String(attr?.value_name||attr?.values?.[0]?.name||'').trim();}
  offerSize(offer:any):string {return this.attributeValue(offer,'SIZE')||this.attributeValue(offer,'APPAREL_SIZE')||this.attributeValue(offer,'SHOE_SIZE')||this.attributeValue(offer,'ALPHANUMERIC_SIZE')||this.attributeValue(offer,'CLOTHING_LOT_SIZE');}
  trackColor(_index:number,group:{key:string}){return group.key;}
  private groupOffers(){
    this.allColorsPrice=null;this.allPriceMessage='';this.allColorsStatus='';this.allStatusMessage='';
    const groups=new Map<string,any>();
    for(const offer of this.draft.offers){
      const colors=(offer.variations??[]).flatMap((variant:any)=>(variant.attribute_combinations??[]).filter((attr:any)=>attr.id==='COLOR').map((attr:any)=>String(attr.value_name||attr.values?.[0]?.name||'').trim())).filter(Boolean);
      const distinct=[...new Set<string>(colors)];
      const color=this.attributeValue(offer,'COLOR')||(distinct.length===1?distinct[0]:distinct.length>1?'Várias cores':'Cor não informada');
      const key=color.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
      if(!groups.has(key))groups.set(key,{color,key,offers:[],pictures:(offer.pictures??[]).map((p:any)=>({...p})),newUrl:'',photoMessage:'',photoEditable:true,bulkPrice:null,priceMessage:'',bulkStatus:'',statusMessage:''});
      groups.get(key)!.offers.push(offer);if(offer.variations?.length)groups.get(key)!.photoEditable=false;
    }
    this.colorGroups=[...groups.values()].sort((a,b)=>a.color.localeCompare(b.color,'pt-BR',{sensitivity:'base'}));
    for(const group of this.colorGroups)group.offers.sort((a:any,b:any)=>compareSizes(this.offerSize(a),this.offerSize(b))||String(a.reference).localeCompare(String(b.reference),'pt-BR',{numeric:true}));
  }
  async uploadPhotos(group:any,event:Event){
    const input=event.target as HTMLInputElement;const files=Array.from(input.files??[]);input.value='';
    if(!files.length||this.busy||!this.validContext())return;
    if(files.length+group.pictures.length>12){group.photoMessage='Use no máximo 12 fotos por cor.';return;}
    if(files.some(file=>!['image/jpeg','image/png'].includes(file.type)||file.size>10*1024*1024||!file.size)){group.photoMessage='Selecione imagens JPG ou PNG de até 10 MB cada.';return;}
    this.setBusy(true);group.uploading=true;group.photoMessage='';let uploaded=0;
    try{
      for(const file of files){if(!this.validContext())break;const form=new FormData();form.append('reference',group.offers[0].reference);form.append('file',file);const picture=await firstValueFrom(this.api.post<{id:string;url:string}>('/chat/listing-editor/photos/upload',form).pipe(takeUntil(this.destroyed)));group.pictures.push(picture);uploaded++;}
      group.photoMessage=uploaded+' foto(s) adicionada(s). Aplique aos tamanhos desta cor e revise as alterações para confirmar.';
    }catch(error){group.photoMessage=(uploaded?uploaded+' foto(s) adicionada(s). ':'')+this.message(error);}
    finally{group.uploading=false;this.setBusy(false);}
  }
  movePhoto(group:any,index:number,direction:number){const target=index+direction;if(target<0||target>=group.pictures.length)return;[group.pictures[index],group.pictures[target]]=[group.pictures[target],group.pictures[index]];}
  validBulkStatus(value:unknown){return value==='active'||value==='paused';}
  applyBulkStatus(group?:any){
    const status=group?group.bulkStatus:this.allColorsStatus;
    if(this.busy||this.phase!=='edit'||!this.validBulkStatus(status)||!this.validContext())return;
    const offers=group?group.offers:this.draft.offers;
    for(const offer of offers)offer.status=status;
    const message='Status '+this.statusLabel(status)+' aplicado a '+offers.length+' anúncio(s) no rascunho. Revise as alterações para confirmar o envio.';
    this.allStatusMessage='';for(const color of this.colorGroups)color.statusMessage='';
    if(group)group.statusMessage=message;else this.allStatusMessage=message;
  }
  validBulkPrice(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>=0.01&&Math.abs(value*100-Math.round(value*100))<0.000001;}
  applyBulkPrice(group?:any){
    const value=group?group.bulkPrice:this.allColorsPrice;
    if(this.busy||this.phase!=='edit'||!this.validBulkPrice(value)||!this.validContext())return;
    const offers=group?group.offers:this.draft.offers;
    for(const offer of offers)offer.price=Math.round(value*100)/100;
    const message='Preço aplicado a '+offers.length+' anúncio(s) no rascunho. Revise as alterações para confirmar o envio.';
    this.allPriceMessage='';for(const color of this.colorGroups)color.priceMessage='';
    if(group)group.priceMessage=message;else this.allPriceMessage=message;
  }
  applyPhotos(group:any){if(!group.pictures.length||group.pictures.length>12)return;for(const offer of group.offers)offer.requestedPictures=group.pictures.map((picture:any)=>picture.id||picture.url);group.photoMessage='Fotos aplicadas ao rascunho. Clique em Revisar alterações para conferir e confirmar o envio.';}
  total(field:string){return this.model.offers.reduce((sum:number,offer:any)=>sum+(offer[field]||0),0);}
  get links(){const links=this.data.children?.flatMap((child:any)=>child.links??[])??this.data.links??[];return [...links].sort((a:any,b:any)=>(a.productVariant?.color??'').localeCompare(b.productVariant?.color??'','pt-BR',{sensitivity:'base'})||compareSizes(a.productVariant?.size??'',b.productVariant?.size??''));}
  get linkedColorGroups(){
    const groups=new Map<string,{key:string;color:string;links:any[]}>();
    for(const link of this.links){
      const color=String(link.productVariant?.color||'Cor não informada').trim()||'Cor não informada';
      const key=color.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
      if(!groups.has(key))groups.set(key,{key,color,links:[]});
      groups.get(key)!.links.push(link);
    }
    return [...groups.values()].sort((a,b)=>a.color.localeCompare(b.color,'pt-BR',{sensitivity:'base'}));
  }
  get cachedOffers(){return this.data.children??[this.data];}
  get validDraft(){return this.draft?.title?.trim()&&this.draft.offers.every((offer:any)=>!offer.photoInvalid&&(offer.description??'').length<=10000&&((offer.description??'')===(this.model.offers.find((old:any)=>old.reference===offer.reference)?.description??'')||!!offer.description?.trim())&&Number.isFinite(offer.price)&&offer.price>0&&(!offer.stockEditable||Number.isInteger(offer.stock)&&offer.stock>=0));}
  safeLink(url:string){return /^https?:\/\//i.test(url||'');}
  statusLabel(value:string){return ({active:'Ativo',paused:'Pausado',closed:'Encerrado',under_review:'Em análise'} as any)[value]||value;}
  chooseAttribute(attribute:any,id:string){const option=attribute.options.find((option:any)=>option.id===id);if(option){attribute.valueId=option.id;attribute.value=option.name;}}
  showOffer(offer:any){this.selectedOffer=this.selectedOffer===offer.reference?'':offer.reference;}
  variationOptions(variant:any){return (variant.attribute_combinations??[]).map((a:any)=>(a.name||a.id)+': '+a.value_name).join(' · ');}
  discardEdit(){this.draft=structuredClone(this.model);this.initializeParentDescription();this.groupOffers();this.phase='view';this.error='';}
  prepare(){
    if(this.busy||!this.validDraft||!this.validContext())return;
    const attributes=this.draft.attributes.filter((attribute:any)=>attribute.editable&&attribute.value!==this.model.attributes.find((old:any)=>old.id===attribute.id)?.value).map((attribute:any)=>({id:attribute.id,value:attribute.value,...(attribute.valueId?{valueId:attribute.valueId}:{})}));
    const offers=this.draft.offers.flatMap((offer:any)=>{const old=this.model.offers.find((old:any)=>old.reference===offer.reference);const change:any={reference:offer.reference};if(offer.requestedVariationPictures)change.variationPictures=offer.requestedVariationPictures;if(offer.requestedPictures)change.pictures=offer.requestedPictures;for(const field of ['price','stock','status','description'])if(offer[field]!==old[field])change[field]=offer[field];return Object.keys(change).length>1?[change]:[];});
    this.setBusy(true);this.error='';this.api.post<any>('/chat/listing-editor/prepare',{reference:this.reference,version:this.model.version,title:this.draft.title,attributes,offers}).pipe(takeUntil(this.destroyed)).subscribe({next:value=>{this.review=value;this.phase='review';this.setBusy(false);},error:error=>{this.error=this.message(error);this.setBusy(false);}});
  }
  confirm(){if(this.busy||!this.review||!this.validContext())return;this.setBusy(true);this.error='';this.api.post<any>('/chat/listing-editor/'+this.review.id+'/confirm').pipe(takeUntil(this.destroyed)).subscribe({next:value=>{this.succeeded=value.success;this.result=value.message;this.changed=true;this.review=undefined;this.phase='done';this.setBusy(false);},error:error=>{this.error=this.message(error);this.result='Não foi possível confirmar o resultado do envio. Atualize os detalhes e confira o histórico antes de repetir.';this.succeeded=false;this.changed=true;this.review=undefined;this.phase='done';this.setBusy(false);}});}
  back(){if(this.busy||!this.review||!this.validContext())return;this.setBusy(true);this.api.post('/chat/listing-editor/'+this.review.id+'/cancel').pipe(takeUntil(this.destroyed)).subscribe({next:()=>{this.review=undefined;this.phase='edit';this.setBusy(false);},error:error=>{this.error=this.message(error);this.setBusy(false);}});}
  close(){if(this.busy)return;if(this.review&&this.validContext()){this.setBusy(true);this.api.post('/chat/listing-editor/'+this.review.id+'/cancel').pipe(takeUntil(this.destroyed)).subscribe({next:()=>this.ref.close(this.changed),error:()=>this.ref.close(this.changed)});}else this.ref.close(this.changed);}
  beginEdit(){if(!this.data.interactionBlocked)this.phase='edit';}
  fiscal(offer:any){if(this.data.interactionBlocked||offer.interactionBlocked)return;this.dialog.open(ListingFiscalDialogComponent,{data:{reference:offer.reference,title:offer.title,onUpdated:()=>this.changed=true},width:'1150px',maxWidth:'97vw',maxHeight:'94vh'}).afterClosed().pipe(takeUntil(this.destroyed)).subscribe(()=>this.load());}
  linkSku(offer:any){if(this.data.interactionBlocked)return;this.dialog.open(SkuLinkDialogComponent,{data:{reference:offer.reference,title:offer.title,onUpdated:()=>this.changed=true},width:'1150px',maxWidth:'97vw',maxHeight:'94vh'}).afterClosed().pipe(takeUntil(this.destroyed)).subscribe(()=>this.load());}
  private message(error:any){const message=error.error?.message;if(typeof message==='string')return message;if(Array.isArray(message))return message.filter((entry:any)=>typeof entry==='string').join(' ');return 'Não foi possível consultar ou atualizar os detalhes. Confira a conexão e tente novamente.';}
  ngOnDestroy(){this.destroyed.next();this.destroyed.complete();}
}
