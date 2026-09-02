import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { API_URL } from '../api.config';

export interface LockStatus {
  pinSet: boolean;
  webauthn: boolean;
}

/**
 * Быстрая разблокировка приложения (PIN + биометрия) поверх активной
 * 30-дневной сессии. НЕ заменяет вход по email/SMS.
 *
 * `unlocked` — состояние в рамках текущей загрузки вкладки: при каждом
 * новом открытии приложения оно сбрасывается в false и показывается
 * экран блокировки (см. App).
 */
@Injectable({ providedIn: 'root' })
export class LockService {
  private readonly http = inject(HttpClient);
  private readonly api = API_URL;

  readonly unlocked = signal(false);
  readonly pinSet = signal(false);
  readonly biometryEnabled = signal(false);

  private deviceBiometrySupported: boolean | null = null;

  markUnlocked(): void {
    this.unlocked.set(true);
  }

  lock(): void {
    this.unlocked.set(false);
  }

  /** Состояние замка с сервера. */
  async loadStatus(): Promise<LockStatus> {
    const status = await firstValueFrom(
      this.http.get<LockStatus>(`${this.api}/auth/lock/status`),
    );
    this.pinSet.set(status.pinSet);
    this.biometryEnabled.set(status.webauthn);
    return status;
  }

  /**
   * Поддерживает ли устройство биометрию (Face ID / отпечаток).
   *
   * Порядок проверок важен (особенно для Safari/WebKit — историческая
   * проблемная зона):
   *   1. существует ли сам класс `PublicKeyCredential` (иначе вызов метода
   *      на старых Safari падает с ошибкой, а не возвращает false);
   *   2. есть ли метод `isUserVerifyingPlatformAuthenticatorAvailable`;
   *   3. сам вызов — в try/catch, потому что на части WebKit он РЕДЖЕКТИТСЯ,
   *      а не резолвится в false (in-app браузеры Telegram/Instagram,
   *      Private Browsing, Lockdown Mode и т.п.).
   *
   * Отличаем «API подтвердил, что биометрии НЕТ» (false, прячем пункт) от
   * «проверить не удалось» (ошибка / метода нет — НЕ прячем, даём
   * попробовать: реальная регистрация сама скажет, если не выйдет).
   * Всё логируем в консоль — иначе на Safari пункт молча исчезает и
   * причину не видно.
   */
  async deviceSupportsBiometry(): Promise<boolean> {
    if (this.deviceBiometrySupported !== null) return this.deviceBiometrySupported;

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '(no navigator)';
    const hasApi =
      typeof window !== 'undefined' &&
      typeof (window as { PublicKeyCredential?: unknown }).PublicKeyCredential === 'function';

    if (!hasApi) {
      console.info('[biometry] WebAuthn недоступен: window.PublicKeyCredential не функция.', { ua });
      this.deviceBiometrySupported = false;
      return false;
    }

    const pkc = (window as unknown as {
      PublicKeyCredential: {
        isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
      };
    }).PublicKeyCredential;

    if (typeof pkc.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
      console.warn(
        '[biometry] PublicKeyCredential есть, но isUserVerifyingPlatformAuthenticatorAvailable нет — ' +
          'отрицание не подтверждено, показываем пункт биометрии.',
        { ua },
      );
      // не кэшируем — вдруг появится
      return true;
    }

    try {
      const available = await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
      console.info('[biometry] isUserVerifyingPlatformAuthenticatorAvailable() =>', available, { ua });
      this.deviceBiometrySupported = available;
      return available;
    } catch (err) {
      const e = err as { name?: string; message?: string };
      console.error(
        '[biometry] isUserVerifyingPlatformAuthenticatorAvailable() ВЫБРОСИЛ ошибку — ' +
          'проверка не удалась (это НЕ значит, что биометрии нет). Показываем пункт.',
        { name: e?.name, message: e?.message, error: err, ua },
      );
      // не кэшируем — перепроверим при следующем вызове
      return true;
    }
  }

  /* ── PIN ─────────────────────────────────────────────────────────── */

  async setPin(pin: string): Promise<void> {
    await firstValueFrom(this.http.post(`${this.api}/auth/pin/set`, { pin }));
    this.pinSet.set(true);
  }

  async verifyPin(pin: string): Promise<void> {
    await firstValueFrom(this.http.post(`${this.api}/auth/pin/verify`, { pin }));
  }

  async changePin(currentPin: string, newPin: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.api}/auth/pin/change`, { currentPin, newPin }),
    );
  }

  /* ── Биометрия (WebAuthn) ────────────────────────────────────────── */

  /** Привязать биометрию текущего устройства. */
  async enableBiometry(): Promise<void> {
    try {
      const options = await firstValueFrom(
        this.http.post<Parameters<typeof startRegistration>[0]>(
          `${this.api}/auth/webauthn/register-options`,
          {},
        ),
      );
      const response = await startRegistration(options);
      await firstValueFrom(
        this.http.post(`${this.api}/auth/webauthn/register-verify`, { response }),
      );
      this.biometryEnabled.set(true);
      console.info('[biometry] регистрация прошла успешно');
    } catch (err) {
      const e = err as { name?: string; message?: string };
      console.error('[biometry] enableBiometry() не удалось:', {
        name: e?.name,
        message: e?.message,
        error: err,
      });
      throw err;
    }
  }

  /** Разблокировать биометрией. Бросает, если пользователь отменил. */
  async unlockWithBiometry(): Promise<void> {
    const options = await firstValueFrom(
      this.http.post<Parameters<typeof startAuthentication>[0]>(
        `${this.api}/auth/webauthn/auth-options`,
        {},
      ),
    );
    const response = await startAuthentication(options);
    await firstValueFrom(
      this.http.post(`${this.api}/auth/webauthn/auth-verify`, { response }),
    );
  }

  async disableBiometry(): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.api}/auth/webauthn/credentials`),
    );
    this.biometryEnabled.set(false);
  }
}
