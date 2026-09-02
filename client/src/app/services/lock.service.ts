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

  /**
   * WebAuthn в принципе возможен в этом контексте (без вопроса «есть ли
   * биометрия» — это отдельная асинхронная проверка isUVPAA). Используем
   * как gate для ПОКАЗА пункта «Включить Face ID» в профиле: даже если
   * isUVPAA() вернул false, пользователь может попробовать — iOS сам
   * подскажет / включит iCloud Keychain, а реальную ошибку мы поймаем.
   */
  webAuthnPossible(): boolean {
    if (typeof window === 'undefined') return false;
    const hasApi =
      typeof (window as { PublicKeyCredential?: unknown }).PublicKeyCredential === 'function';
    const notIframe = window.self === window.top;
    return hasApi && window.isSecureContext && notIframe;
  }

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
   * Строго ли устройство подтверждает наличие биометрии (Face ID / отпечаток).
   * Используется для ПРЕДЛОЖЕНИЯ биометрии при первом входе.
   *
   * Порядок проверок важен для Safari/WebKit:
   *   1. существует ли класс `PublicKeyCredential` (иначе вызов метода на
   *      старых Safari падает с ошибкой, а не возвращает false);
   *   2. есть ли метод `isUserVerifyingPlatformAuthenticatorAvailable`;
   *   3. сам вызов — в try/catch (на части WebKit / in-app браузеров он
   *      реджектится, а не резолвится в false).
   *
   * Различаем «API сказал: биометрии нет» (false) и «проверить не удалось»
   * (метода нет / ошибка → true, пусть реальная регистрация сама решит).
   */
  async deviceSupportsBiometry(): Promise<boolean> {
    if (this.deviceBiometrySupported !== null) return this.deviceBiometrySupported;

    const raw =
      typeof window !== 'undefined'
        ? (window as { PublicKeyCredential?: unknown }).PublicKeyCredential
        : undefined;

    if (typeof raw !== 'function') {
      this.deviceBiometrySupported = false;
      return false;
    }

    const pkc = raw as unknown as {
      isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    };
    if (typeof pkc.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
      return true; // проверить нельзя — не запрещаем
    }

    try {
      const available = await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
      this.deviceBiometrySupported = available;
      return available;
    } catch {
      return true; // ошибка проверки ≠ подтверждённое отсутствие
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
