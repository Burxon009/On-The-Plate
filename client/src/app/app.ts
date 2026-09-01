import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterOutlet } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { AuthService, type AuthIdentifier } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { LanguageService } from './services/language.service';
import { LockService } from './services/lock.service';
import type { TranslationKey } from './i18n/translations';
import { ThemeToggle } from './components/theme-toggle/theme-toggle';
import { LanguageSwitcher } from './components/language-switcher/language-switcher';
import { PinSetup } from './components/pin-setup/pin-setup';
import { BiometrySetup } from './components/biometry-setup/biometry-setup';
import { LockScreen } from './components/lock-screen/lock-screen';

type AuthMethod = 'choose' | 'email' | 'phone';

/** Экран поверх дашборда после/во время входа: замок или первичная настройка. */
type UnlockPhase = 'none' | 'setup-pin' | 'setup-biometry' | 'lock';

@Component({
  imports: [
    RouterOutlet,
    FormsModule,
    ThemeToggle,
    LanguageSwitcher,
    PinSetup,
    BiometrySetup,
    LockScreen,
  ],
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

  // Быстрая разблокировка (PIN / биометрия) поверх активной сессии.
  private readonly lockSvc = inject(LockService);
  readonly unlockPhase = signal<UnlockPhase>('none');

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
        if (restored) void this.enterAfterRestore();
      },
    });
  }

  /**
   * Приложение открыли заново, сессия ещё жива. Показываем экран замка
   * (или, если PIN ещё не задан — обязательную установку PIN).
   */
  private async enterAfterRestore(): Promise<void> {
    void this.router.navigate(['/dashboard']);
    try {
      await this.lockSvc.loadStatus();
      this.unlockPhase.set(this.lockSvc.pinSet() ? 'lock' : 'setup-pin');
    } catch {
      // Статус не получить (нет сети) — не запираем наглухо, пускаем внутрь.
      this.lockSvc.markUnlocked();
      this.unlockPhase.set('none');
    }
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
        // Порядок после первого входа: приветствие (2.5 c) → установка PIN
        // → предложение биометрии → дашборд.
        setTimeout(() => {
          this.showGreeting.set(false);
          void this.afterFullLogin();
        }, 2500);
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

  /** После полного входа (email/SMS): решаем, нужна ли установка PIN. */
  private async afterFullLogin(): Promise<void> {
    try {
      await this.lockSvc.loadStatus();
    } catch {
      // Не критично — при первом входе PIN всё равно попросим ниже.
    }
    if (!this.lockSvc.pinSet()) {
      this.unlockPhase.set('setup-pin');
    } else {
      this.lockSvc.markUnlocked();
      this.unlockPhase.set('none');
    }
  }

  /** PIN установлен → сразу (тем же потоком) предлагаем биометрию, если есть. */
  onPinCreated(): void {
    void this.continueAfterPin();
  }

  private async continueAfterPin(): Promise<void> {
    if (await this.lockSvc.deviceSupportsBiometry()) {
      this.unlockPhase.set('setup-biometry');
    } else {
      this.finishUnlock(false);
    }
  }

  /** Биометрия включена или пропущена — идём на дашборд. */
  onBiometryFinished(): void {
    this.finishUnlock(false);
  }

  /** Замок открыт (PIN или биометрия) — показываем приветствие, затем дашборд. */
  onUnlocked(): void {
    this.finishUnlock(true);
  }

  /** Лимит попыток PIN / «забыл PIN» — назад на полный вход. */
  onLockedOut(): void {
    this.unlockPhase.set('none');
    this.lockSvc.lock();
    this.auth.logout();
  }

  private finishUnlock(withGreeting: boolean): void {
    this.lockSvc.markUnlocked();
    this.unlockPhase.set('none');
    if (withGreeting) {
      this.greetingName.set((this.auth.user()?.name ?? '').trim());
      this.showGreeting.set(true);
      setTimeout(() => this.showGreeting.set(false), 2500);
    }
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
