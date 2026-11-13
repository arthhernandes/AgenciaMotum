import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { publicApiUrl } from './api-url';

export interface Page<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}
  url(path:string){return publicApiUrl(path);}

  get<T>(url: string, params?: Record<string, string | number | boolean | undefined>): Observable<T> {
    let httpParams = new HttpParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== '') httpParams = httpParams.set(key, String(value));
    });
    const selectedAccountId = localStorage.getItem('selectedMarketplaceAccountId');
    if (selectedAccountId && url !== '/marketplace-accounts/business' && !httpParams.has('marketplaceAccountId')) {
      httpParams = httpParams.set('marketplaceAccountId', selectedAccountId);
    }
    return this.http.get<T>(`/api${url}`, { params: httpParams });
  }

  post<T>(url: string, body: unknown = {}): Observable<T> {
    let params = new HttpParams();
    const selectedAccountId = localStorage.getItem('selectedMarketplaceAccountId');
    if (selectedAccountId) params = params.set('marketplaceAccountId', selectedAccountId);
    return this.http.post<T>(`/api${url}`, body, { params });
  }

  delete<T>(url: string): Observable<T> {
    const accountId = localStorage.getItem('selectedMarketplaceAccountId');
    return this.http.delete<T>(`/api${url}`, { params: accountId ? {marketplaceAccountId: accountId} : {} });
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly token$ = new BehaviorSubject<string | null>(localStorage.getItem('token'));

  constructor(private readonly http: HttpClient) {}

  login(email: string, password: string) {
    return this.http.post<{ accessToken: string; user: unknown }>('/api/auth/login', { email, password }).pipe(tap((result) => {
      localStorage.setItem('token', result.accessToken);
      this.token$.next(result.accessToken);
    }));
  }

  logout() {
    localStorage.removeItem('token');
    this.token$.next(null);
  }

  token() {
    return this.token$.value;
  }
}
