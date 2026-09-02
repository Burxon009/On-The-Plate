import { Component, OnInit, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../api.config';
import { AuthService, type User } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { LockService } from '../../services/lock.service';
import { HttpErrorResponse } from '@angular/common/http';

const MAX_AVATAR_DIMENSION = 300;
const AVATAR_JPEG_QUALITY = 0.7;

/**
 * Модалка настроек профиля: имя, телефон (просто контактное поле, без
 * подтверждения), email (через код подтверждения на новый адрес) и фото
 * (сжимается на клиенте через Canvas до 300×300 JPEG перед отправкой).
 */
@Component({
  selector: 'app-profile-settings',
  imports: [FormsModule],
  templateUrl: './profile-settings.html',
  styleUrl: './profile-settings.scss',
})
export class ProfileSettings implements OnInit {
  readonly closed = output<void>();

  private readonly http = inject(HttpClient);
  private readonly apiUrl = API_URL;
  readonly auth = inject(AuthService);
  readonly lang = inject(LanguageService);
  readonly lock = inject(LockService);

  readonly name = signal('');
  readonly phone = signal('');
  readonly avatar = signal<string | null>(null);

  readonly newEmail = signal('');
  readonly emailCodeRequested = signal(false);
  readonly emailCode = signal('');

  readonly savingProfile = signal(false);
  readonly sendingCode = signal(false);
  readonly confirmingEmail = signal(false);
  readonly uploadingAvatar = signal(false);

  readonly profileMessage = signal('');
  readonly emailMessage = signal('');
  readonly error = signal('');

  // — быстрая разблокировка —
  readonly biometrySupported = signal(false);
  readonly biometryEnabled = this.lock.biometryEnabled;
  readonly togglingBiometry = signal(false);
  readonly biometryError = signal('');

  readonly showPinForm = signal(false);
  readonly pinCurrent = signal('');
  readonly pinNew = signal('');
  readonly pinRepeat = signal('');
  readonly changingPin = signal(false);
  readonly pinMessage = signal('');
  readonly pinError = signal('');

  ngOnInit(): void {
    // В сигнале сессии обычно нет phone/avatar — тянем полный профиль.
    this.applyUser(this.auth.user());
    this.auth.loadCurrentUser().subscribe({
      next: (user) => this.applyUser(user),
      error: () => undefined,
    });

    // Пункт «Face ID / отпечаток» показываем, если WebAuthn тут в принципе
    // возможен (API есть, HTTPS, не iframe) — даже когда isUVPAA() вернул
    // false: пользователь сможет попробовать, а точную причину покажет
    // диагностический блок ниже (lock.biometryDiag).
    this.biometrySupported.set(this.lock.webAuthnPossible());
    void this.lock.deviceSupportsBiometry();
    void this.lock.loadStatus().catch(() => undefined);
  }

  togglePinForm(): void {
    this.showPinForm.update((v) => !v);
    this.pinCurrent.set('');
    this.pinNew.set('');
    this.pinRepeat.set('');
    this.pinError.set('');
    this.pinMessage.set('');
  }

  async submitPinChange(): Promise<void> {
    if (this.changingPin()) return;

    const current = this.pinCurrent().trim();
    const next = this.pinNew().trim();
    const repeat = this.pinRepeat().trim();

    if (!/^\d{4}$/.test(current) || !/^\d{4}$/.test(next)) {
      this.pinError.set(this.lang.t('pinSetupPrompt'));
      return;
    }
    if (next !== repeat) {
      this.pinError.set(this.lang.t('pinSetupMismatch'));
      return;
    }

    this.changingPin.set(true);
    this.pinError.set('');
    this.pinMessage.set('');
    try {
      await this.lock.changePin(current, next);
      this.pinMessage.set(this.lang.t('profilePinChanged'));
      this.showPinForm.set(false);
      this.pinCurrent.set('');
      this.pinNew.set('');
      this.pinRepeat.set('');
    } catch (err) {
      this.pinError.set(
        err instanceof HttpErrorResponse && err.status === 400
          ? err.error?.message || this.lang.t('profilePinWrong')
          : this.lang.t('errorRequestFailed'),
      );
    } finally {
      this.changingPin.set(false);
    }
  }

  async enableBiometry(): Promise<void> {
    if (this.togglingBiometry()) return;
    this.togglingBiometry.set(true);
    this.biometryError.set('');
    try {
      await this.lock.enableBiometry();
    } catch (err) {
      if (!isUserCancellation(err)) {
        this.biometryError.set(this.lang.t('biometryFailed'));
      }
    } finally {
      this.togglingBiometry.set(false);
    }
  }

  async disableBiometry(): Promise<void> {
    if (this.togglingBiometry()) return;
    this.togglingBiometry.set(true);
    this.biometryError.set('');
    try {
      await this.lock.disableBiometry();
    } catch {
      this.biometryError.set(this.lang.t('errorRequestFailed'));
    } finally {
      this.togglingBiometry.set(false);
    }
  }

  private applyUser(user: User | null): void {
    if (!user) return;
    this.name.set(user.name ?? '');
    this.phone.set(user.phone ?? '');
    this.avatar.set(user.avatar_base64 ?? null);
  }

  close(): void {
    this.closed.emit();
  }

  saveProfile(): void {
    if (this.savingProfile()) return;
    this.savingProfile.set(true);
    this.error.set('');
    this.profileMessage.set('');

    this.http
      .patch<{ user: User }>(`${this.apiUrl}/users/me`, {
        name: this.name().trim(),
        phone: this.phone().trim() || null,
      })
      .subscribe({
        next: ({ user }) => {
          this.applyUser(user);
          this.auth.user.set(user);
          this.savingProfile.set(false);
          this.profileMessage.set(this.lang.t('profileSaved'));
        },
        error: (err) => {
          this.savingProfile.set(false);
          this.error.set(err.error?.message || 'Не удалось сохранить профиль');
        },
      });
  }

  requestEmailChange(): void {
    if (this.sendingCode()) return;
    const email = this.newEmail().trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.error.set('Некорректный email');
      return;
    }
    this.sendingCode.set(true);
    this.error.set('');
    this.emailMessage.set('');

    this.http
      .post(`${this.apiUrl}/users/me/email/request-change`, { newEmail: email })
      .subscribe({
        next: () => {
          this.sendingCode.set(false);
          this.emailCodeRequested.set(true);
          this.emailMessage.set(this.lang.t('profileEmailCodeHint'));
        },
        error: (err) => {
          this.sendingCode.set(false);
          this.error.set(err.error?.message || 'Не удалось отправить код');
        },
      });
  }

  confirmEmailChange(): void {
    if (this.confirmingEmail()) return;
    const code = this.emailCode().trim();
    if (!/^\d{6}$/.test(code)) {
      this.error.set('Код состоит из 6 цифр');
      return;
    }
    this.confirmingEmail.set(true);
    this.error.set('');

    this.http
      .post<{ user: User }>(`${this.apiUrl}/users/me/email/confirm-change`, { code })
      .subscribe({
        next: ({ user }) => {
          this.applyUser(user);
          this.auth.user.set(user);
          this.confirmingEmail.set(false);
          this.emailCodeRequested.set(false);
          this.emailCode.set('');
          this.newEmail.set('');
          this.emailMessage.set(this.lang.t('profileSaved'));
        },
        error: (err) => {
          this.confirmingEmail.set(false);
          this.error.set(err.error?.message || 'Не удалось подтвердить email');
        },
      });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.error.set('');
    this.uploadingAvatar.set(true);

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const compressed = this.compressToDataUrl(img);
        if (!compressed) {
          this.uploadingAvatar.set(false);
          this.error.set('Не удалось обработать изображение');
          return;
        }
        this.sendAvatar(compressed);
      };
      img.onerror = () => {
        this.uploadingAvatar.set(false);
        this.error.set('Не удалось прочитать изображение');
      };
      img.src = String(reader.result);
    };
    reader.onerror = () => {
      this.uploadingAvatar.set(false);
      this.error.set('Не удалось прочитать файл');
    };
    reader.readAsDataURL(file);

    // сбрасываем input, чтобы повторный выбор того же файла сработал
    input.value = '';
  }

  private compressToDataUrl(img: HTMLImageElement): string | null {
    const scale = Math.min(1, MAX_AVATAR_DIMENSION / Math.max(img.width, img.height));
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY);
  }

  private sendAvatar(dataUrl: string): void {
    this.http
      .post<{ avatar_base64: string }>(`${this.apiUrl}/users/me/avatar`, { image: dataUrl })
      .subscribe({
        next: ({ avatar_base64 }) => {
          this.avatar.set(avatar_base64);
          const current = this.auth.user();
          if (current) this.auth.user.set({ ...current, avatar_base64 });
          this.uploadingAvatar.set(false);
          this.profileMessage.set(this.lang.t('profileSaved'));
        },
        error: (err) => {
          this.uploadingAvatar.set(false);
          this.error.set(err.error?.message || 'Не удалось загрузить фото');
        },
      });
  }
}

function isUserCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  );
}
