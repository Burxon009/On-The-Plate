import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { BackStackService } from '../../services/back-stack.service';
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
  private readonly backStack = inject(BackStackService);

  readonly open = signal(false);

  toggle(): void {
    if (this.open()) {
      this.backStack.back();
    } else {
      this.open.set(true);
      this.backStack.push('menu', () => this.open.set(false));
    }
  }

  /** Клик по фону / выбор пункта — закрываем через back-стек. */
  close(): void {
    this.backStack.back();
  }

  onProfile(): void {
    // Меню сменяется экраном профиля: снимаем слой меню без шага назад,
    // дашборд сам откроет профиль отдельным слоем.
    this.backStack.forget('menu');
    this.open.set(false);
    this.openProfile.emit();
  }

  onLogout(): void {
    this.backStack.forget('menu');
    this.open.set(false);
    this.auth.logout();
  }
}
