import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { ThemeToggle } from '../theme-toggle/theme-toggle';
import { LanguageSwitcher } from '../language-switcher/language-switcher';

/**
 * Гамбургер-меню главного экрана: одна кнопка ☰ раскрывает стеклянную
 * панель с переключателем темы, выбором языка, пунктом «Профиль» и
 * выходом. Заменяет собой отдельные кнопки темы и logout в шапке.
 */
@Component({
  selector: 'app-hamburger-menu',
  imports: [ThemeToggle, LanguageSwitcher],
  templateUrl: './hamburger-menu.html',
  styleUrl: './hamburger-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HamburgerMenu {
  /** Клиент нажал «Профиль» — dashboard открывает модалку профиля. */
  readonly openProfile = output<void>();

  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);

  readonly open = signal(false);

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onProfile(): void {
    this.close();
    this.openProfile.emit();
  }

  onLogout(): void {
    this.close();
    this.auth.logout();
  }
}
