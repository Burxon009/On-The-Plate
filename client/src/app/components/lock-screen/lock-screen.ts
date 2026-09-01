import { ChangeDetectionStrategy, Component, OnInit, inject, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { LanguageService } from '../../services/language.service';
import { LockService } from '../../services/lock.service';
import { PinPad } from '../pin-pad/pin-pad';

/**
 * Экран блокировки при повторных открытиях приложения (сессия ещё жива).
 * Биометрия (если включена) предлагается автоматически при открытии;
 * PIN — всегда доступный запасной способ.
 */
@Component({
  selector: 'app-lock-screen',
  templateUrl: './lock-screen.html',
  styleUrl: './lock-screen.scss',
  imports: [PinPad],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LockScreen implements OnInit {
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

  ngOnInit(): void {
    if (this.biometryEnabled()) {
      void this.tryBiometry();
    }
  }

  async tryBiometry(): Promise<void> {
    if (this.busy() || this.biometryRunning()) return;
    this.biometryRunning.set(true);
    this.error.set('');
    try {
      await this.lock.unlockWithBiometry();
      this.unlocked.emit();
    } catch (error) {
      if (!isUserCancellation(error)) {
        this.error.set(this.lang.t('lockBiometryFailed'));
      }
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

function isUserCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  );
}
