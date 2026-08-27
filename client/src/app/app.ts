import { Component, signal } from '@angular/core';
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

  // Все поля состояния формы входа — signals.
  // Это zoneless-приложение (без zone.js): экран перерисовывается только
  // когда меняется signal или срабатывает DOM-событие внутри шаблона.
  // Обычные переменные класса, изменённые внутри HTTP-callback'а,
  // НЕ вызывают перерисовку сами по себе — именно это раньше вызывало
  // эффект "зависшей" кнопки, пока пользователь не трогал поле ввода.
  phone = signal('');
  private verificationPhone = '';
  code = signal('');
  name = signal('');
  codeRequested = signal(false);
  loading = signal(false);
  error = signal('');
  devCode = signal<string | null>(null);

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
    if (this.loading()) {
      return;
    }

    const normalizedPhone = this.normalizePhone(this.phone());

    if (!/^\+998\d{9}$/.test(normalizedPhone)) {
      this.error.set('Некорректный номер. Формат: +998XXXXXXXXX (9 цифр после +998)');
      return;
    }

    this.loading.set(true);
    this.error.set('');
    this.devCode.set(null);

    this.auth.requestCode(normalizedPhone).pipe(
      timeout(8000),
      finalize(() => {
        this.loading.set(false);
      }),
    ).subscribe({
      next: (response) => {
        this.verificationPhone = normalizedPhone;
        this.codeRequested.set(true);
        // devCode приходит только в DEV-режиме — в проде его не будет.
        this.devCode.set(response.devCode ?? null);
      },
      error: (error) => {
        this.error.set(
          error.name === 'TimeoutError'
            ? 'Сервер отвечает слишком долго. Попробуйте ещё раз.'
            : error.error?.message || 'Не удалось отправить код',
        );
      },
    });
  }

  verifyCode(): void {
    if (this.loading()) {
      return;
    }

    if (!this.verificationPhone) {
      this.error.set('Сначала запросите код повторно.');
      return;
    }

    if (!this.code().trim()) {
      this.error.set('Введите SMS-код');
      return;
    }

    if (!this.name().trim()) {
      this.error.set('Введите ваше имя');
      return;
    }

    this.loading.set(true);
    this.error.set('');

    this.auth.verifyCode(this.verificationPhone, this.code().trim(), this.name().trim()).pipe(
      timeout(8000),
      finalize(() => {
        this.loading.set(false);
      }),
    ).subscribe({
      next: () => {
        this.verificationPhone = '';
        this.name.set('');
        void this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        this.error.set(
          error.name === 'TimeoutError'
            ? 'Сервер отвечает слишком долго. Попробуйте ещё раз.'
            : error.error?.message || 'Не удалось подтвердить код',
        );
      },
    });
  }

  /**
   * Вернуться на экран ввода телефона, не перезагружая страницу.
   */
  changePhone(): void {
    this.codeRequested.set(false);
    this.verificationPhone = '';
    this.code.set('');
    this.devCode.set(null);
    this.error.set('');
  }

  private normalizePhone(phone: string): string {
    return phone.trim().replace(/[\s()-]/g, '');
  }
}
