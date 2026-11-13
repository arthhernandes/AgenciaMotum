import { Component, HostListener, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { UI_IMPORTS } from '../../shared/ui';

@Component({
  selector: 'app-listing-photo-preview',
  standalone: true,
  imports: [...UI_IMPORTS, MatDialogModule],
  template: `
    <header><h2 mat-dialog-title>Foto {{index + 1}} de {{data.pictures.length}}</h2><button mat-icon-button mat-dialog-close aria-label="Fechar foto ampliada"><mat-icon>close</mat-icon></button></header>
    <div class="preview" [attr.aria-busy]="loading">
      <mat-progress-bar *ngIf="loading" mode="indeterminate" aria-label="Carregando foto"></mat-progress-bar>
      <img *ngIf="!failed" [src]="data.pictures[index].url" [alt]="'Foto '+(index+1)+' do anúncio ampliada'" referrerpolicy="no-referrer" (load)="loading=false" (error)="loading=false;failed=true">
      <p *ngIf="failed" role="alert">Não foi possível carregar a foto. <button mat-button (click)="reload()">Tentar novamente</button></p>
    </div>
    <footer *ngIf="data.pictures.length > 1"><button mat-stroked-button (click)="move(-1)" [disabled]="index===0" aria-label="Foto anterior"><mat-icon>chevron_left</mat-icon>Anterior</button><span aria-live="polite">{{index===0?'Capa':'Foto '+(index+1)}}</span><button mat-stroked-button (click)="move(1)" [disabled]="index===data.pictures.length-1" aria-label="Próxima foto">Próxima<mat-icon>chevron_right</mat-icon></button></footer>
  `,
  styles: [`:host{display:flex;flex-direction:column;max-height:90dvh;background:#fff}header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-right:12px;flex-shrink:0}h2{margin:0;font-size:17px}.preview{position:relative;display:flex;align-items:center;justify-content:center;min-height:180px;min-width:0;overflow:auto;padding:8px 16px}.preview img{display:block;max-width:100%;max-height:calc(90dvh - 150px);object-fit:contain}.preview img[hidden]{display:none}.preview mat-progress-bar{position:absolute;top:0;left:0;width:100%}.preview p{padding:24px;text-align:center;color:#697386}footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;flex-shrink:0}footer span{font-size:12px;color:#697386}footer button{font-size:12px}`]
})
export class ListingPhotoPreviewComponent {
  index:number;
  loading=true;
  failed=false;
  constructor(@Inject(MAT_DIALOG_DATA) public data:{pictures:{url:string}[];index:number}){this.index=data.index;}
  move(direction:number){const next=this.index+direction;if(next<0||next>=this.data.pictures.length)return;this.loading=true;this.failed=false;this.index=next;}
  reload(){this.failed=false;this.loading=true;}
  @HostListener('document:keydown',['$event']) key(event:KeyboardEvent){if(event.key==='ArrowLeft'){event.preventDefault();this.move(-1);}if(event.key==='ArrowRight'){event.preventDefault();this.move(1);}}
}
