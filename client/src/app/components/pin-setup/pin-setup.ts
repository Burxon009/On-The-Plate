import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { LanguageService } from '../../services/language.service';
import { LockService } from '../../services/lock.service';
import { PinPad } from '../pin-pad/pin-pad';

/**
 * Экран (c) первого входа: обязательная установка PIN. Без «Пропустить».
 * Просит ввести PIN дважды; кнопка «Продолжить» активна только когда обе
 * попытки набраны и совпали.
 */
@Component({
  selector: 'app-pin-setup',
  templateUrl: './pin-setup.html',
  styleUrl: './pin-setup.scss',
  imports: [PinPad],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PinSetup {
  private readonly lock = inject(LockService);
  readonly lang = inject(LanguageService);

  /** PIN установлен на сервере — родитель ведёт дальше (биометрия / дашборд). */
  readonly created = output<void>();

  readonly phase = signal<'enter' | 'repeat'>('enter');
  readonly entry = signal('');
  readonly ready = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');

  private firstPin = '';
  private confirmedPin = '';

  onCompleted(pin: string): void {
    if (this.saving()) return;

    if (this.phase() === 'enter') {
      this.firstPin = pin;
      this.entry.set('');
      this.error.set('');
      this.phase.set('repeat');
      return;
    }

    if (pin !== this.firstPin) {
      this.error.set(this.lang.t('pinSetupMismatch'));
      this.resetToStart();
      return;
    }

    this.confirmedPin = pin;
    this.ready.set(true);
  }

  /** Пользователь изменил вторую попытку после совпадения — снимаем готовность. */
  onEntryChange(value: string): void {
    this.entry.set(value);
    if (this.ready() && value.length < 4) {
      this.ready.set(false);
    }
  }

  async submit(): Promise<void> {
    if (!this.ready() || this.saving()) return;

    this.saving.set(true);
    this.error.set('');
    try {
      await this.lock.setPin(this.confirmedPin);
      this.created.emit();
    } catch {
      this.error.set(this.lang.t('errorRequestFailed'));
      this.resetToStart();
    } finally {
      this.saving.set(false);
    }
  }

  private resetToStart(): void {
    this.firstPin = '';
    this.confirmedPin = '';
    this.entry.set('');
    this.ready.set(false);
    this.phase.set('enter');
  }
}
