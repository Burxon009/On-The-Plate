import { Injectable, signal } from '@angular/core';
import { LANGUAGES, translations, type Lang, type TranslationKey } from '../i18n/translations';

const STORAGE_KEY = 'language-preference';
const DEFAULT_LANG: Lang = 'ru';

/**
 * Signal-based выбор языка интерфейса (по образцу ThemeService).
 * Хранит выбор в localStorage; при отсутствии выбора — русский.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly _lang = signal<Lang>(this.readStored());

  /** Текущий язык — читай в шаблонах через `lang.current()`. */
  readonly current = this._lang.asReadonly();

  readonly available = LANGUAGES;

  setLang(lang: Lang): void {
    if (!LANGUAGES.includes(lang)) return;
    this._lang.set(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // localStorage недоступен (приватный режим и т.п.) — не критично.
    }
  }

  /**
   * Перевод по ключу. Реактивен: обращение к _lang() внутри делает
   * шаблон зависимым от смены языка (важно для zoneless-приложения).
   */
  t(key: TranslationKey): string {
    const lang = this._lang();
    return translations[lang][key] ?? translations[DEFAULT_LANG][key] ?? key;
  }

  private readStored(): Lang {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'ru' || stored === 'uz' || stored === 'en') {
        return stored;
      }
    } catch {
      // недоступен — молча используем язык по умолчанию.
    }
    return DEFAULT_LANG;
  }
}
