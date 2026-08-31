import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterOutlet } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { ThemeToggle } from './components/theme-toggle/theme-toggle';

@Component({
  imports: [RouterOutlet, FormsModule, ThemeToggle],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  // Создаём сервис темы сразу при старте приложения, чтобы data-theme
  // на <html> проставился как можно раньше.
  private readonly theme = inject(ThemeService);

  protected get isLoggedIn() {
    return this.auth.isLoggedIn;
  }

  // Все поля состояния формы входа — signals.
  // Это zoneless-приложение (без zone.js): экран перерисовывается только
  // когда меняется signal или срабатывает DOM-событие внутри шаблона.
  email = signal('');
  private verificationEmail = '';
  code = signal('');
  name = signal('');
  codeRequested = signal(false);
  loading = signal(false);
  error = signal('');

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    this.auth.restoreSession().pipe(timeout(8000)).subscribe({
      next: (restored) => {
        if (restored) void this.router.navigate(['/dashboard']);
      },
    });
  }

  login(): void {
    if (this.loading()) {
      return;
    }

    const normalizedEmail = this.normalizeEmail(this.email());

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      this.error.set('Некорректный email. Проверьте формат адреса.');
      return;
    }

    this.loading.set(true);
    this.error.set('');

    this.auth.requestCode(normalizedEmail).pipe(
      timeout(8000),
      finalize(() => {
        this.loading.set(false);
      }),
    ).subscribe({
      next: (response) => {
        this.verificationEmail = normalizedEmail;
        this.codeRequested.set(true);
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

    if (!this.verificationEmail) {
      this.error.set('Сначала запросите код повторно.');
      return;
    }

    if (!this.code().trim()) {
      this.error.set('Введите код из письма');
      return;
    }

    if (!this.name().trim()) {
      this.error.set('Введите ваше имя');
      return;
    }

    this.loading.set(true);
    this.error.set('');

    this.auth.verifyCode(this.verificationEmail, this.code().trim(), this.name().trim()).pipe(
      timeout(8000),
      finalize(() => {
        this.loading.set(false);
      }),
    ).subscribe({
      next: () => {
        this.verificationEmail = '';
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
   * Вернуться на экран ввода email, не перезагружая страницу.
   */
  changeEmail(): void {
    this.codeRequested.set(false);
    this.verificationEmail = '';
    this.code.set('');
    this.error.set('');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
