import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { LanguageService } from '../../services/language.service';
import { LockService } from '../../services/lock.service';
import { PinPad } from '../pin-pad/pin-pad';

/**
 * Экран блокировки при повторных открытиях приложения (сессия ещё жива).
 * PIN виден и доступен сразу; биометрия — ТОЛЬКО по явному тапу на кнопку
 * «Войти по Face ID / отпечатку», без авто-вызова при открытии экрана.
 *
 * Почему без авто-вызова: navigator.credentials.get() без явного жеста
 * пользователя на мобильных браузерах ненадёжен (Chrome/Android может
 * тихо отказать), а credential в принципе привязан к КОНКРЕТНОМУ
 * устройству/authenticator'у — на новом устройстве его там и не будет,
 * это не ошибка. Раз запрос теперь всегда идёт по явному тапу, молчать
 * при неудаче нельзя — пользователь ждёт ответа на своё действие.
 */
@Component({
  selector: 'app-lock-screen',
  templateUrl: './lock-screen.html',
  styleUrl: './lock-screen.scss',
  imports: [PinPad],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LockScreen {
  private readonly lock = inject(LockService);
  readonly lang = inject(LanguageService);

  /** Разблокировано (PIN или биометрия) — родитель показывает приветствие. */
  readonly unlocked = output<void>();
  /** Нужен полный вход заново (лимит попыток / «забыл PIN»). */
  readonly lockedOut = output<void>();

  readonly biometryEnabled = this.lock.biometryEnabled;
  readonly entry = signal('');
  readonly busy = signal(false);
  readonly biometryRunning = signal(false);
  readonly error = signal('');

  /** Вызывается ТОЛЬКО по явному тапу пользователя на кнопку биометрии. */
  async tryBiometry(): Promise<void> {
    if (this.busy() || this.biometryRunning()) return;
    this.biometryRunning.set(true);
    this.error.set('');
    try {
      await this.lock.unlockWithBiometry();
      this.unlocked.emit();
    } catch {
      // Кнопку нажал сам пользователь — молчать в ответ нельзя. Браузер
      // отдаёт один и тот же NotAllowedError и при отмене системного
      // диалога, и при реальном сбое (нет credential на этом устройстве,
      // таймаут) — WebAuthn их не различает, поэтому сообщаем в любом
      // случае и подсказываем оба выхода: PIN или включить биометрию
      // именно на этом устройстве через профиль.
      this.error.set(this.lang.t('lockBiometryUnavailable'));
    } finally {
      this.biometryRunning.set(false);
    }
  }

  async onPinCompleted(pin: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.lock.verifyPin(pin);
      this.unlocked.emit();
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 423) {
        this.error.set(this.lang.t('lockLockedOut'));
        setTimeout(() => this.lockedOut.emit(), 1200);
        return;
      }
      const serverMessage =
        error instanceof HttpErrorResponse ? error.error?.message : null;
      this.error.set(serverMessage || this.lang.t('lockWrongPin'));
      this.entry.set('');
    } finally {
      this.busy.set(false);
    }
  }

  forgot(): void {
    this.lockedOut.emit();
  }
}
