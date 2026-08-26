import crypto from "crypto";
import { pool } from "./db";
import { smsService } from "./smsService";

const CODE_TTL_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;

// Формат: только Узбекистан, +998 и 9 цифр.
const PHONE_REGEX = /^\+998\d{9}$/;

const CODE_PEPPER = process.env.CODE_PEPPER ?? process.env.JWT_SECRET ?? "";

if (!CODE_PEPPER) {
  throw new Error("CODE_PEPPER (или JWT_SECRET) не задан в .env");
}

export function isValidPhone(phone: unknown): phone is string {
  return typeof phone === "string" && PHONE_REGEX.test(phone);
}

function hashCode(phone: string, code: string): string {
  return crypto
    .createHmac("sha256", CODE_PEPPER)
    .update(`${phone}:${code}`)
    .digest("hex");
}

function generateCode(): string {
  // 6-значный код, без ведущего 0 не требуется — просто строка из цифр.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export class VerificationError extends Error {}

/**
 * Запросить код подтверждения для номера телефона.
 *
 * Возвращает код только в DEV-режиме (для тестирования без реального
 * SMS-провайдера). В проде код никогда не возвращается наружу —
 * он уходит через smsService.sendSms.
 */
export async function requestVerificationCode(
  phone: string
): Promise<{ devCode?: string }> {
  if (!isValidPhone(phone)) {
    throw new VerificationError(
      "Некорректный номер телефона. Формат: +998XXXXXXXXX"
    );
  }

  const recentResult = await pool.query(
    `
    SELECT created_at
    FROM verification_codes
    WHERE phone = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [phone]
  );

  if (recentResult.rows.length > 0) {
    const lastCreatedAt = new Date(recentResult.rows[0].created_at);
    const secondsSinceLast = (Date.now() - lastCreatedAt.getTime()) / 1000;

    if (secondsSinceLast < RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLast);
      throw new VerificationError(
        `Повторная отправка возможна через ${wait} сек.`
      );
    }
  }

  const code = generateCode();
  const codeHash = hashCode(phone, code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await pool.query(
    `
    INSERT INTO verification_codes (phone, code_hash, expires_at)
    VALUES ($1, $2, $3)
    `,
    [phone, codeHash, expiresAt]
  );

  await smsService.sendSms(
    phone,
    `Код подтверждения U CAFE Loyalty: ${code}. Никому не сообщайте его.`
  );

  const isDev = process.env.NODE_ENV !== "production";

  return isDev ? { devCode: code } : {};
}

/**
 * Проверить код подтверждения.
 *
 * Бросает VerificationError с понятным сообщением, если код
 * неверный, истёк, уже использован или превышено число попыток.
 */
export async function verifyCode(
  phone: string,
  code: string
): Promise<void> {
  if (!isValidPhone(phone)) {
    throw new VerificationError(
      "Некорректный номер телефона. Формат: +998XXXXXXXXX"
    );
  }

  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    throw new VerificationError("Код должен состоять из 6 цифр");
  }

  const client = await pool.connect();

  // Установлено, если код неверный — бросаем ошибку ПОСЛЕ COMMIT,
  // чтобы не пытаться сделать ROLLBACK по уже закоммиченной транзакции.
  let wrongCodeError: VerificationError | null = null;

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      SELECT id, code_hash, attempts, max_attempts, expires_at, consumed_at
      FROM verification_codes
      WHERE phone = $1
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [phone]
    );

    if (result.rows.length === 0) {
      throw new VerificationError(
        "Код не запрошен для этого номера. Сначала запросите код."
      );
    }

    const row = result.rows[0];

    if (row.consumed_at) {
      throw new VerificationError(
        "Код уже использован. Запросите новый."
      );
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new VerificationError("Срок действия кода истёк. Запросите новый.");
    }

    if (row.attempts >= row.max_attempts) {
      throw new VerificationError(
        "Превышено число попыток. Запросите новый код."
      );
    }

    const expectedHash = hashCode(phone, code);
    const isMatch = expectedHash === row.code_hash;

    if (!isMatch) {
      await client.query(
        `UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1`,
        [row.id]
      );

      const attemptsLeft = row.max_attempts - (row.attempts + 1);
      wrongCodeError = new VerificationError(
        attemptsLeft > 0
          ? `Неверный код. Осталось попыток: ${attemptsLeft}`
          : "Неверный код. Превышено число попыток."
      );
    } else {
      await client.query(
        `UPDATE verification_codes SET consumed_at = NOW() WHERE id = $1`,
        [row.id]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (wrongCodeError) {
    throw wrongCodeError;
  }
}
