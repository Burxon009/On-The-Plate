import { Injectable } from '@angular/core';

type CloseFn = () => void;

/**
 * Кнопка «Назад» телефона / браузера = один шаг назад по слоям приложения
 * (оверлеям), а не выход со страницы.
 *
 * Механика: каждый открытый слой кладёт запись в history.state. Единственный
 * слушатель popstate закрывает верхний слой. На «дне» держим якорь — «Назад»
 * на главном экране просто остаётся на месте, из приложения не выкидывает.
 *
 * URL не трогаем (pushState с текущим location.href), чтобы Angular Router
 * не реагировал на эти записи.
 */
@Injectable({ providedIn: 'root' })
export class BackStackService {
  private readonly layers: { id: string; close: CloseFn }[] = [];
  private ready = false;

  /** Вызвать один раз, когда пользователь дошёл до главного экрана. */
  init(): void {
    if (this.ready || typeof window === 'undefined') return;
    this.ready = true;

    this.pushEntry('anchor');
    window.addEventListener('popstate', () => {
      const top = this.layers.pop();
      if (top) top.close();
      // всегда оставляем один шаг «вперёд», чтобы следующий «Назад»
      // тоже пришёл сюда, а не увёл со страницы
      this.pushEntry(top ? top.id : 'anchor');
    });
  }

  /** Слой открылся — «Назад» его закроет. `close` только прячет слой. */
  push(id: string, close: CloseFn): void {
    if (!this.ready) this.init();
    if (this.layers.some((l) => l.id === id)) return;
    this.layers.push({ id, close });
    this.pushEntry(id);
  }

  /** Закрыть верхний слой из UI (крестик, клик по фону, Esc). */
  back(): void {
    if (this.layers.length > 0) {
      history.back();
    }
  }

  /**
   * Слой исчез не через «Назад» (logout, переход в другой поток) — снять
   * его и всё, что было выше, с учёта. Историю не трогаем: лишняя запись
   * на «дне» просто отработает как no-op.
   */
  forget(id: string): void {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i !== -1) this.layers.splice(i);
  }

  private pushEntry(id: string): void {
    history.pushState({ ...history.state, backStack: id }, '', location.href);
  }
}
