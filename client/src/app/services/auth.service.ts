import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';
import { API_URL } from '../api.config';

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: string;
  qr_token?: string;
  phone?: string | null;
  avatar_base64?: string | null;
}

interface SessionResponse {
  token: string;
  user: User;
}

interface RequestCodeResponse { message: string; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = API_URL;
  private accessToken: string | null = null;
  private restoreInFlight: Observable<SessionResponse | null> | null = null;
  readonly user = signal<User | null>(null);
  readonly isLoggedIn = signal(false);

  constructor(private readonly http: HttpClient, private readonly router: Router) {}

  isAuthenticated(): boolean { return Boolean(this.accessToken); }
  getToken(): string | null { return this.accessToken; }

  requestCode(email: string): Observable<RequestCodeResponse> {
    return this.http.post<RequestCodeResponse>(`${this.apiUrl}/auth/request-code`, { email });
  }

  verifyCode(email: string, code: string, name: string): Observable<SessionResponse> {
    return this.http.post<SessionResponse>(`${this.apiUrl}/auth/verify-code`, { email, code, name }).pipe(
      tap((session) => this.setSession(session)),
    );
  }

  restoreSession(force = false): Observable<boolean> {
    if (this.accessToken && !force) return of(true);
    if (!this.restoreInFlight) {
      this.restoreInFlight = this.http.post<SessionResponse>(`${this.apiUrl}/auth/refresh`, {}).pipe(
        tap((session) => this.setSession(session)),
        catchError(() => of(null)),
        tap((session) => { if (!session) this.clearLocalSession(); }),
        finalize(() => { this.restoreInFlight = null; }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
    }
    return this.restoreInFlight.pipe(map((session) => Boolean(session?.token)));
  }

  loadCurrentUser(): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}/users/me`).pipe(tap((user) => this.user.set(user)));
  }

  logout(): void {
    this.http.post(`${this.apiUrl}/auth/logout`, {}).subscribe({ error: () => undefined });
    this.clearLocalSession();
    void this.router.navigate(['/']);
  }

  clearLocalSession(): void {
    this.accessToken = null;
    this.user.set(null);
    this.isLoggedIn.set(false);
  }

  private setSession(session: SessionResponse): void {
    this.accessToken = session.token;
    this.user.set(session.user);
    this.isLoggedIn.set(true);
  }
}
