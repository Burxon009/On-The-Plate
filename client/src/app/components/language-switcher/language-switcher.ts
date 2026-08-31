import { UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LanguageService } from '../../services/language.service';
import type { Lang } from '../../i18n/translations';

/** Три компактные кнопки RU / UZ / EN. Переиспользуется на входе и в меню. */
@Component({
  selector: 'app-language-switcher',
  imports: [UpperCasePipe],
  templateUrl: './language-switcher.html',
  styleUrl: './language-switcher.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageSwitcher {
  readonly lang = inject(LanguageService);

  select(value: Lang): void {
    this.lang.setLang(value);
  }
}
