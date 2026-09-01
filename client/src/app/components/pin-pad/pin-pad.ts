import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';

/**
 * 4 кружка + собственная цифровая клавиатура. Не полагается на системную
 * клавиатуру телефона — так PIN вводится одинаково в вебе и в Capacitor.
 * Родитель получает готовый PIN через (completed), когда набраны 4 цифры.
 */
@Component({
  selector: 'app-pin-pad',
  templateUrl: './pin-pad.html',
  styleUrl: './pin-pad.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PinPad {
  /** Заблокировать ввод (во время запроса к серверу). */
  readonly disabled = input(false);

  /** Текущее значение PIN (0–4 цифры). Двусторонняя привязка. */
  readonly value = model('');

  /** Срабатывает, когда набрана 4-я цифра. */
  readonly completed = output<string>();

  readonly keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  readonly dots = computed(() => {
    const filled = this.value().length;
    return [0, 1, 2, 3].map((i) => i < filled);
  });

  press(key: string): void {
    if (this.disabled() || key === '') return;

    if (key === 'del') {
      this.value.set(this.value().slice(0, -1));
      return;
    }

    if (this.value().length >= 4) return;

    const next = this.value() + key;
    this.value.set(next);

    if (next.length === 4) {
      this.completed.emit(next);
    }
  }
}
