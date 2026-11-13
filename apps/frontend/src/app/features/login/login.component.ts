import { Component } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';

@Component({
  selector: 'app-login', standalone: true, imports: UI_IMPORTS,
  template: `
    <section class="login-page">
      <aside class="login-visual">
        <div class="login-brand"><img class="consultor-login-logo" src="/assets/branding/o-consultor-emblem.png" alt="" /><span>O Consultor</span></div>
        <div class="login-copy"><h2>Seus anúncios.<br>Uma visão clara.</h2><p>Centralize produtos, encontre divergências e mantenha seu catálogo saudável em todos os marketplaces.</p></div>
      </aside>
      <div class="login-form-wrap">
        <form class="login-panel" [formGroup]="form" (ngSubmit)="submit()">
          <span class="eyebrow">ACESSO SEGURO</span><h1>Entre na sua conta</h1><p class="intro">Use suas credenciais para acessar a central de anúncios.</p>
          <mat-form-field appearance="outline"><mat-label>E-mail</mat-label><mat-icon matPrefix>mail_outline</mat-icon><input matInput type="email" autocomplete="email" formControlName="email"></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Senha</mat-label><mat-icon matPrefix>lock_outline</mat-icon><input matInput type="password" autocomplete="current-password" formControlName="password"></mat-form-field>
          <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || loading">{{ loading ? 'Entrando…' : 'Entrar' }}</button>
          <p class="error" *ngIf="error">{{ error }}</p>
        </form>
      </div>
    </section>
  `
})
export class LoginComponent {
  loading=false; error='';
  form=this.fb.group({email:['',[Validators.required,Validators.email]],password:['',Validators.required]});
  constructor(private readonly fb:FormBuilder,private readonly auth:AuthService,private readonly router:Router,private readonly route:ActivatedRoute){}
  submit(){if(this.form.invalid)return;this.loading=true;this.error='';this.auth.login(this.form.value.email??'',this.form.value.password??'').subscribe({next:()=>void this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('returnUrl')||'/dashboard'),error:()=>{this.error='Não foi possível autenticar. Verifique os dados e tente novamente.';this.loading=false}})}
}
