import { AfterViewChecked, Directive, ElementRef, Input, Renderer2 } from '@angular/core';
import { AccessService } from './access.service';

@Directive({selector:'[appPermission]',standalone:true})
export class PermissionDirective implements AfterViewChecked {
  @Input() appPermission='';private last?:boolean;
  constructor(private access:AccessService,private element:ElementRef,private renderer:Renderer2){}
  ngAfterViewChecked(){const allowed=this.appPermission.split(/\s+/).filter(Boolean).every(key=>this.access.can(key));if(this.last===allowed)return;this.last=allowed;if(allowed)this.renderer.removeStyle(this.element.nativeElement,'display');else this.renderer.setStyle(this.element.nativeElement,'display','none',1);}
}
