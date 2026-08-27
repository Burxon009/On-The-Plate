import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterOutlet } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { AuthService } from './services/auth.service';

@Component({
  imports: [RouterOutlet, FormsModule],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected get isLoggedIn() {
    return this.auth.isLoggedIn;
  }
  phone = '';
  private verificationPhone = '';
  code = '';
  name = '';
  codeRequested = false;
  devCode: string | null = null;
  loading = false;
  error = '';

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    if (this.isLoggedIn()) {
      this.auth.loadCurrentUser().pipe(
        timeout(8000),
      ).subscribe({
        next: () => {
          this.isLoggedIn.set(true);
          void this.router.navigate(['/dashboard']);
        },
        error: () => {
          this.auth.logout();
          this.isLoggedIn.set(false);
        },
      });
    }
  }

  login(): void {
    if (this.loading) {
      return;
    }

    const normalizedPhone = this.normalizePhone(this.phone);

    if (!/^\+998\d{9}$/.test(normalizedPhone)) {
      this.error = 'Некорректный номер. Формат: +998XXXXXXXXX';
      return;
    }

    this.loading = true;
    this.error = '';

    this.auth.requestCode(normalizedPhone).pipe(
      timeout(8000),
      finalize(() => {
        this.loading = false;
      }),
    ).subscribe({
      next: (response) => {
        this.verificationPhone = normalizedPhone;
        this.codeRequested = true;
        this.devCode = response.devCode ?? null;
      },
      error: (error) => {
        this.error = error.name === 'TimeoutError'
          ? 'Сервер отвечает слишком долго. Попробуйте ещё раз.'
          : error.error?.message || 'Не удалось отправить код';
      },
    });
  }

  verifyCode(): void {
    if (this.loading) {
      return;
    }

    if (!this.verificationPhone) {
      this.error = 'Сначала запросите код повторно.';
      return;
    }

    if (!this.code.trim()) {
      this.error = 'Введите SMS-код';
      return;
    }

    if (!this.name.trim()) {
      this.error = 'Введите ваше имя';
      return;
    }

    this.loading = true;
    this.error = '';

    this.auth.verifyCode(this.verificationPhone, this.code.trim(), this.name.trim()).pipe(
      timeout(8000),
      finalize(() => {
        this.loading = false;
      }),
    ).subscribe({
      next: () => {
        this.verificationPhone = '';
        this.name = '';
        void this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        this.error = error.name === 'TimeoutError'
          ? 'Сервер отвечает слишком долго. Попробуйте ещё раз.'
          : error.error?.message || 'Не удалось подтвердить код';
      },
    });
  }

  changePhone(): void {
    this.codeRequested = false;
    this.verificationPhone = '';
    this.code = '';
    this.devCode = null;
    this.error = '';
  }

  private normalizePhone(phone: string): string {
    return phone.trim().replace(/[\s()-]/g, '');
  }
}
