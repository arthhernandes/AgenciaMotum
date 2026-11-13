import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { publicApiUrl } from './api-url';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if(!req.url.startsWith('/api/'))return next(req);
  const router = inject(Router);
  const token = localStorage.getItem('token');
  return next(req.clone({url:publicApiUrl(req.url),...(token?{setHeaders:{Authorization:`Bearer ${token}`}}:{})})).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !req.url.includes('/api/auth/login')) {
        localStorage.removeItem('token');
        void router.navigate(['/login'], { queryParams: { returnUrl: `${location.pathname}${location.search}` } });
      }
      return throwError(() => error);
    })
  );
};
