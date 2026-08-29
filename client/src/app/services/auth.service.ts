import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: string;
  qr_token?: string;
}

interface VerifyCodeResponse {
  token: string;
  user: User;
}

interface RequestCodeResponse {
  message: string;
  devCode?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = 'http://localhost:3000';
  private readonly tokenKey = 'token';
  readonly user = signal<User | null>(null);
  readonly isLoggedIn = signal(Boolean(localStorage.getItem(this.tokenKey)));

  constructor(
    private readonly http: HttpClient,
    private readonly router: Router,
  ) {}

  isAuthenticated(): boolean {
    return Boolean(localStorage.getItem(this.tokenKey));
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  requestCode(email: string): Observable<RequestCodeResponse> {
    return this.http
      .post<RequestCodeResponse>(`${this.apiUrl}/auth/request-code`, { email });
  }

  verifyCode(email: string, code: string, name: string): Observable<VerifyCodeResponse> {
    return this.http
      .post<VerifyCodeResponse>(`${this.apiUrl}/auth/verify-code`, { email, code, name })
      .pipe(
        tap(({ token, user }) => {
          localStorage.setItem(this.tokenKey, token);
          this.user.set(user);
          this.isLoggedIn.set(true);
        }),
      );
  }

  loadCurrentUser(): Observable<User> {
    return this.http
      .get<User>(`${this.apiUrl}/users/me`)
      .pipe(tap((user) => this.user.set(user)));
  }

  logout(): void {
    localStorage.removeItem(this.tokenKey);
    this.user.set(null);
    this.isLoggedIn.set(false);
    void this.router.navigate(['/']);
  }
}
