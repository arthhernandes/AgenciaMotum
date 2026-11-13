import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Routes } from '@angular/router';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { paginatorPtBr } from './app/core/paginator-pt-br';
import { AppComponent } from './app/app.component';
import { ShellComponent } from './app/shell.component';
import { authInterceptor } from './app/core/auth.interceptor';
import { authGuard } from './app/core/auth.guard';
import { adminGuard } from './app/core/admin.guard';
import { permissionGuard } from './app/core/access.service';
import { LoginComponent } from './app/features/login/login.component';
import { MapComponent } from './app/features/map/map.component';
import { ListingsComponent } from './app/features/listings/listings.component';
import { AuditComponent } from './app/features/audit/audit.component';
import { SyncComponent } from './app/features/sync/sync.component';
import { AccountsComponent } from './app/features/accounts/accounts.component';
import { DashboardComponent } from './app/features/dashboard/dashboard.component';
import { SettingsComponent } from './app/features/settings/settings.component';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeng/themes/aura';
import { definePreset } from '@primeng/themes';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    canActivateChild:[permissionGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'mapa' },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'relatorios', loadComponent:()=>import('./app/features/reports/reports.component').then(module=>module.ReportsComponent) },
      { path: 'chat', loadComponent: () => import('./app/features/chat/chat.component').then(module => module.ChatComponent) },
      { path: 'mapa', component: MapComponent },
      { path: 'produtos', pathMatch: 'full', redirectTo: 'mapa' },
      { path: 'anuncios', component: ListingsComponent },
      { path: 'auditoria', component: AuditComponent },
      { path: 'pendencias', loadComponent: () => import('./app/features/operations/pending.component').then(module=>module.PendingComponent) },
      { path: 'modelos-fiscais', loadComponent: () => import('./app/features/operations/fiscal-templates.component').then(module=>module.FiscalTemplatesComponent) },
      { path: 'sincronizacoes', component: SyncComponent },
      { path: 'contas', component: AccountsComponent },
      { path: 'historico', canActivate:[adminGuard], loadComponent:()=>import('./app/features/users/activity.component').then(module=>module.ActivityComponent) },
      { path: 'usuarios', canActivate:[adminGuard], loadComponent:()=>import('./app/features/users/users.component').then(module=>module.UsersComponent) },
      { path: 'sem-acesso', loadComponent:()=>import('./app/features/users/no-access.component').then(module=>module.NoAccessComponent) },
      { path: 'configuracoes', component: SettingsComponent }
    ]
  }
];

bootstrapApplication(AppComponent, {
  providers: [{provide:MatPaginatorIntl,useFactory:paginatorPtBr},provideAnimations(), provideHttpClient(withInterceptors([authInterceptor])), provideRouter(routes), providePrimeNG({
    theme: { preset: definePreset(Aura, { semantic: { primary: { 50: '#eff7fb', 100: '#d9ebf5', 200: '#b6d8ec', 300: '#84bddc', 400: '#4b9ec7', 500: '#217ca8', 600: '#0b4f78', 700: '#094365', 800: '#073752', 900: '#062b40', 950: '#031a29' } } }), options: { darkModeSelector: false } }
  })]
}).catch((err) => console.error(err));
