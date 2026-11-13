import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ApiService } from './api.service';

export const adminGuard:CanActivateFn=()=>{
  const router=inject(Router);
  return inject(ApiService).get<any>('/auth/me').pipe(map(user=>user.role==='ADMIN'?true:router.createUrlTree(['/dashboard'])),catchError(()=>of(router.createUrlTree(['/login']))));
};
