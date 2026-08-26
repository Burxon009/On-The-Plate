import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';

export interface User {
  id: number;
  phone: string;
  name: string | null;
  role: string;
  qr_token?: string;
}

interface LoginResponse {
  token: string;
  user: User;
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

  login(phone: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.apiUrl}/auth/login`, { phone })
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
