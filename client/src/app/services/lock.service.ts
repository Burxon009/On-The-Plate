import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
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

  /** Поддерживает ли устройство биометрию (Face ID / отпечаток). */
  async deviceSupportsBiometry(): Promise<boolean> {
    if (this.deviceBiometrySupported !== null) return this.deviceBiometrySupported;
    try {
      this.deviceBiometrySupported =
        browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable());
    } catch {
      this.deviceBiometrySupported = false;
    }
    return this.deviceBiometrySupported;
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
