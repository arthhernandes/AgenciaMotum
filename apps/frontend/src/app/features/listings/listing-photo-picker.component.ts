import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ListingPhotoPreviewComponent } from './listing-photo-preview.component';
import { ListingPhotoClipboardService } from './listing-photo-clipboard.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UI_IMPORTS } from '../../shared/ui';

@Component({selector:'app-listing-photo-picker',standalone:true,imports:[...UI_IMPORTS,MatDialogModule],template:`<section class="photo-paste-area" tabindex="0" (paste)="pasteImage($event)" aria-label="Fotos do an?ncio. Clique aqui e use Ctrl+V para colar uma imagem.">
 <div class="photo-grid"><article *ngFor="let picture of pictures;let i=index"><button type="button" class="photo-preview" (click)="preview(i)" [attr.aria-label]="'Ampliar foto '+(i+1)" matTooltip="Ampliar foto"><img [src]="picture.url" alt="Foto da variação" referrerpolicy="no-referrer"><mat-icon>zoom_in</mat-icon></button><small>{{i===0?'Capa':'Foto '+(i+1)}}</small><div class="photo-actions"><button type="button" mat-icon-button (click)="copy(picture)" [disabled]="copying" [attr.aria-label]="'Copiar foto '+(i+1)" matTooltip="Copiar foto"><mat-icon>content_copy</mat-icon></button><button mat-icon-button (click)="move(i,-1)" [disabled]="busy || i===0" aria-label="Mover foto para antes"><mat-icon>arrow_back</mat-icon></button><button mat-icon-button (click)="move(i,1)" [disabled]="busy || i===pictures.length-1" aria-label="Mover foto para depois"><mat-icon>arrow_forward</mat-icon></button><button mat-icon-button (click)="remove(i)" [disabled]="busy" aria-label="Remover foto"><mat-icon>delete_outline</mat-icon></button></div></article></div>
 <div *ngIf="copying" class="upload-progress" role="status"><strong>Copiando imagem...</strong><mat-progress-bar mode="indeterminate" aria-label="Copiando imagem"></mat-progress-bar></div><div *ngIf="uploadMessage" class="upload-progress" role="status" aria-live="polite" aria-busy="true"><strong>{{uploadMessage}}</strong><mat-progress-bar mode="indeterminate" aria-label="Envio de fotos em andamento"></mat-progress-bar><small>Aguarde a conclusão do envio.</small></div>
 <label class="photo-upload">{{uploadMessage ? 'Enviando fotos…' : 'Adicionar fotos do computador'}}<input type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.avif" multiple (change)="select($event)" [disabled]="busy || !!uploadMessage || pictures.length>=12" [attr.aria-label]="label"></label><button type="button" class="paste-photo" mat-stroked-button (click)="paste()" [disabled]="busy || !!uploadMessage || !clipboard.picture || pictures.length>=12" matTooltip="Copie uma foto no sistema para reutilizar nesta conta"><mat-icon>content_paste</mat-icon>Colar foto copiada</button><small *ngIf="photoNotice" class="photo-notice" role="status" aria-live="polite">{{photoNotice}}</small><small>Clique na ?rea de fotos e pressione Ctrl+V para colar uma imagem.</small><small>JPG, PNG, WebP ou AVIF, até 10 MB por foto. Imagens compatíveis são convertidas automaticamente quando necessário. A primeira foto será a capa.</small>
</section>`,styles:[`.photo-paste-area:focus-visible{outline:2px solid #07537b;outline-offset:4px;border-radius:6px}.paste-photo{margin:8px 0 8px 10px;font-size:12px}.photo-notice{padding:8px 10px;margin:4px 0;border-radius:6px;background:#edf6fc;color:#07537b;font-size:12px}.photo-actions{flex-wrap:wrap}.upload-progress{display:grid;gap:8px;padding:12px 14px;margin:10px 0;border:1px solid #c8e1ef;border-radius:8px;background:#edf6fc;color:#07537b;max-width:520px;overflow-wrap:anywhere;font-size:13px}.upload-progress small{color:#52657b}.photo-grid{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.photo-grid article{border:1px solid #dce5ef;border-radius:8px;padding:6px;background:white}.photo-preview{position:relative;display:block;padding:0;border:0;border-radius:5px;background:white;cursor:zoom-in}.photo-preview:focus-visible{outline:2px solid #07537b;outline-offset:3px}.photo-preview>mat-icon{position:absolute;right:3px;bottom:3px;width:22px;height:22px;font-size:20px;border-radius:4px;background:#ffffffe6;color:#07537b}.photo-grid img{width:125px;height:125px;object-fit:contain}.photo-grid small{display:block;text-align:center;color:#697386;font-size:12px}.photo-actions{display:flex;justify-content:center}.photo-actions button{width:36px;height:36px;padding:6px}.photo-upload{display:inline-block;padding:10px 14px;border:1px solid #cbd5e1;border-radius:8px;color:#07537b;font-size:13px;cursor:pointer;margin:8px 0}.photo-upload:has(input:disabled){opacity:.55;cursor:default}.photo-upload input{display:none}small{display:block;color:#697386;font-size:12px;line-height:1.5}`]})
export class ListingPhotoPickerComponent {
 constructor(private readonly dialog:MatDialog,public readonly clipboard:ListingPhotoClipboardService,private readonly http:HttpClient){}
 preview(index:number){this.dialog.open(ListingPhotoPreviewComponent,{data:{pictures:this.pictures.map(p=>({url:p.url})),index},width:'960px',maxWidth:'96vw',maxHeight:'92dvh',ariaLabel:'Visualizar fotos do an\u00fancio'});}

 @Input() pictures:any[]=[];
 @Input() busy=false;
 @Input() uploadMessage='';
 @Input() label='Adicionar fotos da variação';
 @Output() filesSelected=new EventEmitter<File[]>();
 @Output() picturesChange=new EventEmitter<void>();
 photoNotice='';
 copying=false;
 private async clipboardImage(id:string):Promise<Blob>{
   const blob=await firstValueFrom(this.http.get('/api/listing-links/sku/photo/'+encodeURIComponent(id),{responseType:'blob'}));
   const bitmap=await createImageBitmap(blob);
   try{const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');if(!context)throw new Error('Canvas unavailable');context.drawImage(bitmap,0,0);return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Conversion failed')),'image/png'));}finally{bitmap.close();}
 }
 async copy(picture:any){
   if(this.copying)return;
   if(!picture.id||!picture.url){this.photoNotice='Esta foto ainda não está disponível para copiar.';return;}
   this.clipboard.copy(picture);
   if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined'){this.photoNotice='Este navegador não permite copiar imagens com Ctrl+V. Use Colar foto copiada no anúncio de destino.';return;}
   this.copying=true;this.photoNotice='Copiando imagem para a área de transferência…';
   try{await navigator.clipboard.write([new ClipboardItem({'image/png':this.clipboardImage(picture.id)})]);this.photoNotice='Imagem copiada! No destino, clique na área de fotos e pressione Ctrl+V. Você também pode usar Colar foto copiada.';}
   catch{this.photoNotice='Não foi possível copiar a imagem para Ctrl+V. Ela está disponível em Colar foto copiada dentro do painel.';}
   finally{this.copying=false;}
 }
 pasteImage(event:ClipboardEvent){
   const files=Array.from(event.clipboardData?.items??[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file);
   if(!files.length)return;event.preventDefault();
   if(this.busy||this.uploadMessage){this.photoNotice='Aguarde o envio atual terminar antes de colar outra foto.';return;}
   if(this.pictures.length+files.length>12){this.photoNotice='Use no máximo 12 fotos. Remova uma foto antes de colar.';return;}
   this.filesSelected.emit(files);
 }
 paste(){
   if(this.busy||this.uploadMessage)return;
   const picture=this.clipboard.picture;if(!picture)return;
   if(this.pictures.length>=12){this.photoNotice='Use no máximo 12 fotos. Remova uma foto antes de colar.';return;}
   if(this.pictures.some(photo=>photo.id===picture.id||photo.url===picture.url)){this.photoNotice='Esta foto já está neste anúncio ou nesta cor.';return;}
   this.pictures.push({...picture});this.picturesChange.emit();this.photoNotice='Foto adicionada ao rascunho. Confira a ordem e revise as alterações antes de confirmar.';
 }
 remove(index:number){if(this.busy)return;this.pictures.splice(index,1);this.picturesChange.emit();}
 select(event:Event){const input=event.target as HTMLInputElement,files=Array.from(input.files??[]);input.value='';if(!this.busy&&files.length)this.filesSelected.emit(files);}
 move(index:number,direction:number){const target=index+direction;if(this.busy||target<0||target>=this.pictures.length)return;[this.pictures[index],this.pictures[target]]=[this.pictures[target],this.pictures[index]];this.picturesChange.emit();}
}
