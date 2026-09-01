import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterOutlet } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { AuthService, type AuthIdentifier } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { LanguageService } from './services/language.service';
import type { TranslationKey } from './i18n/translations';
import { ThemeToggle } from './components/theme-toggle/theme-toggle';
import { LanguageSwitcher } from './components/language-switcher/language-switcher';

type AuthMethod = 'choose' | 'email' | 'phone';

@Component({
  imports: [RouterOutlet, FormsModule, ThemeToggle, LanguageSwitcher],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  // Создаём сервис темы сразу при старте приложения, чтобы data-theme
  // на <html> проставился как можно раньше.
  private readonly theme = inject(ThemeService);

  readonly lang = inject(LanguageService);

  protected get isLoggedIn() {
    return this.auth.isLoggedIn;
  }

  // Все поля состояния формы входа — signals.
  // Это zoneless-приложение (без zone.js): экран перерисовывается только
  // когда меняется signal или срабатывает DOM-событие внутри шаблона.

  /** Экран выбора способа входа → ввод email/телефона → ввод кода. */
  readonly authMethod = signal<AuthMethod>('choose');

  email = signal('');
  phone = signal('');
  private verificationId: AuthIdentifier | null = null;

  code = signal('');
  name = signal('');
  codeRequested = signal(false);
  loading = signal(false);
  error = signal('');

  // Экран приветствия (~2.5 c после успешного входа).
  readonly showGreeting = signal(false);
  readonly greetingName = signal('');

  /** Приветствие по времени суток, на выбранном языке. */
  greetingText(): string {
    const h = new Date().getHours();
    const key: TranslationKey =
      h >= 5 && h < 12 ? 'greetingMorning'
      : h >= 12 && h < 18 ? 'greetingDay'
      : h >= 18 && h < 23 ? 'greetingEvening'
      : 'greetingNight';
    return this.lang.t(key);
  }

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

  /** Выбрать способ входа (email или телефон). */
  chooseMethod(method: 'email' | 'phone'): void {
    this.authMethod.set(method);
    this.error.set('');
  }

  /** Вернуться к экрану выбора способа входа. */
  backToMethods(): void {
    this.authMethod.set('choose');
    this.codeRequested.set(false);
    this.code.set('');
    this.error.set('');
    this.verificationId = null;
  }

  login(): void {
    if (this.loading()) {
      return;
    }

    let identifier: AuthIdentifier;

    if (this.authMethod() === 'phone') {
      const phone = this.phone().trim().replace(/[\s()\-.]/g, '');
      if (!/^\+[1-9]\d{8,14}$/.test(phone)) {
        this.error.set(this.lang.t('errorPhoneInvalid'));
        return;
      }
      identifier = { phone };
    } else {
      const email = this.normalizeEmail(this.email());
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        this.error.set(this.lang.t('errorEmailInvalid'));
        return;
      }
      identifier = { email };
    }

    this.loading.set(true);
    this.error.set('');

    this.auth.requestCode(identifier).pipe(
      timeout(15000),
      finalize(() => {
        this.loading.set(false);
      }),
    ).subscribe({
      next: () => {
        this.verificationId = identifier;
        this.codeRequested.set(true);
      },
      error: (error) => {
        this.error.set(
          error.name === 'TimeoutError'
            ? this.lang.t('errorServerSlow')
            : error.error?.message || this.lang.t('errorRequestFailed'),
        );
      },
    });
  }

  verifyCode(): void {
    if (this.loading()) {
      return;
    }

    if (!this.verificationId) {
      this.error.set(this.lang.t('errorRequestFailed'));
      return;
    }

    if (!this.code().trim()) {
      this.error.set(this.lang.t('errorEnterCode'));
      return;
    }

    if (!this.name().trim()) {
      this.error.set(this.lang.t('errorEnterName'));
      return;
    }

    this.loading.set(true);
    this.error.set('');

    this.auth.verifyCode(this.verificationId, this.code().trim(), this.name().trim()).pipe(
      timeout(15000),
      finalize(() => {
        this.loading.set(false);
      }),
    ).subscribe({
      next: (session) => {
        this.verificationId = null;
        this.name.set('');
        // Имя для приветствия — из СВЕЖЕГО ответа verify-code (актуальное
        // из БД на этот момент, с учётом смены имени через профиль),
        // а не из закэшированного значения.
        this.greetingName.set((session.user?.name ?? '').trim());
        this.showGreeting.set(true);
        void this.router.navigate(['/dashboard']);
        setTimeout(() => this.showGreeting.set(false), 2500);
      },
      error: (error) => {
        this.error.set(
          error.name === 'TimeoutError'
            ? this.lang.t('errorServerSlow')
            : error.error?.message || this.lang.t('errorConfirmFailed'),
        );
      },
    });
  }

  /** Вернуться на экран ввода email/телефона, не перезагружая страницу. */
  changeIdentifier(): void {
    this.codeRequested.set(false);
    this.code.set('');
    this.error.set('');
    this.verificationId = null;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
