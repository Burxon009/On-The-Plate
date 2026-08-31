import { Injectable, computed, effect, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

/** null = явного выбора нет, тема следует за системными настройками. */
type Preference = Theme | null;

const STORAGE_KEY = 'theme-preference';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  /**
   * matchMedia есть не везде (jsdom в тестах, старые окружения) — работаем
   * без него, тогда системная тема просто считается светлой.
   */
  private readonly media =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  /** Явный выбор пользователя (из localStorage), либо null. */
  private readonly preference = signal<Preference>(this.readStoredPreference());

  /** Текущая системная тема — обновляется живым слушателем matchMedia. */
  private readonly systemTheme = signal<Theme>(this.media?.matches ? 'dark' : 'light');

  /**
   * Итоговая тема: выбор пользователя имеет приоритет; пока выбора нет —
   * значение живо следует за systemTheme.
   */
  readonly currentTheme = computed<Theme>(() => this.preference() ?? this.systemTheme());

  constructor() {
    // Живое отслеживание системной темы. На currentTheme влияет только
    // пока preference() === null, но слушатель работает всегда.
    this.media?.addEventListener('change', (event) => {
      this.systemTheme.set(event.matches ? 'dark' : 'light');
    });

    // Применяем тему к <html data-theme="...">.
    effect(() => {
      const theme = this.currentTheme();
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', theme);
      }
    });
  }

  /** Ручное переключение — фиксирует явный выбор и запоминает его. */
  toggleTheme(): void {
    const next: Theme = this.currentTheme() === 'dark' ? 'light' : 'dark';
    this.preference.set(next);
    this.writeStoredPreference(next);
  }

  private readStoredPreference(): Preference {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'light' || stored === 'dark' ? stored : null;
    } catch {
      return null;
    }
  }

  private writeStoredPreference(value: Theme): void {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // localStorage недоступен (приватный режим и т.п.) — не критично.
    }
  }
}
