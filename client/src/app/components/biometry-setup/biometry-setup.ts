import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { LanguageService } from '../../services/language.service';
import { LockService } from '../../services/lock.service';

/**
 * Экран (d) первого входа: предложение включить биометрию. Показывается
 * СРАЗУ после установки PIN и ТОЛЬКО если устройство поддерживает
 * биометрию (проверку делает родитель до показа). Здесь есть «Пропустить».
 */
@Component({
  selector: 'app-biometry-setup',
  templateUrl: './biometry-setup.html',
  styleUrl: './biometry-setup.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BiometrySetup {
  private readonly lock = inject(LockService);
  readonly lang = inject(LanguageService);

  /** Шаг завершён (включили или пропустили) — родитель ведёт на дашборд. */
  readonly finished = output<void>();

  readonly busy = signal(false);
  readonly error = signal('');

  async enable(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.lock.enableBiometry();
      this.finished.emit();
    } catch (error) {
      // Пользователь отменил системный диалог — молча остаёмся на экране.
      if (isUserCancellation(error)) {
        this.error.set('');
      } else {
        this.error.set(this.lang.t('biometryFailed'));
      }
    } finally {
      this.busy.set(false);
    }
  }

  skip(): void {
    if (this.busy()) return;
    this.finished.emit();
  }
}

function isUserCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  );
}
