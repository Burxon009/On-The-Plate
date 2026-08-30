import crypto from "crypto";
import { pool } from "./db";
import { emailService } from "./emailService";

const CODE_TTL_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;

// Простая, но рабочая проверка формата email.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CODE_PEPPER = process.env.CODE_PEPPER ?? process.env.JWT_SECRET ?? "";

if (!CODE_PEPPER) {
  throw new Error("CODE_PEPPER (или JWT_SECRET) не задан в .env");
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && EMAIL_REGEX.test(email);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashCode(identifier: string, code: string): string {
  return crypto
    .createHmac("sha256", CODE_PEPPER)
    .update(`${identifier}:${code}`)
    .digest("hex");
}

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export class VerificationError extends Error {}

export async function cleanupVerificationCodes(): Promise<void> {
  await pool.query(`
    DELETE FROM verification_codes
    WHERE expires_at < NOW() - INTERVAL '24 hours'
       OR (consumed_at IS NOT NULL AND consumed_at < NOW() - INTERVAL '24 hours')
  `);
}

/**
 * Запросить код подтверждения на email.
 *
 * Возвращает код только в DEV-режиме (для тестирования без реального
 * email-провайдера). В проде код никогда не возвращается наружу —
 * он уходит через emailService.sendEmail.
 */
export async function requestVerificationCode(email: string): Promise<void> {
  if (!isValidEmail(email)) {
    throw new VerificationError("Некорректный email");
  }

  const identifier = normalizeEmail(email);

  const recentResult = await pool.query(
    `
    SELECT created_at
    FROM verification_codes
    WHERE identifier = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [identifier]
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
  const codeHash = hashCode(identifier, code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await pool.query(
    `
    INSERT INTO verification_codes (identifier, code_hash, expires_at)
    VALUES ($1, $2, $3)
    `,
    [identifier, codeHash, expiresAt]
  );

  await emailService.sendEmail(
    identifier,
    "Код подтверждения On the plate",
    `Ваш код подтверждения: ${code}. Никому не сообщайте его. Код действителен 5 минут.`
  );

  return;
}

/**
 * Проверить код подтверждения.
 */
export async function verifyCode(
  email: string,
  code: string
): Promise<void> {
  if (!isValidEmail(email)) {
    throw new VerificationError("Некорректный email");
  }

  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    throw new VerificationError("Код должен состоять из 6 цифр");
  }

  const identifier = normalizeEmail(email);

  const client = await pool.connect();

  let wrongCodeError: VerificationError | null = null;

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      SELECT id, code_hash, attempts, max_attempts, expires_at, consumed_at
      FROM verification_codes
      WHERE identifier = $1
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [identifier]
    );

    if (result.rows.length === 0) {
      throw new VerificationError(
        "Код не запрошен для этого email. Сначала запросите код."
      );
    }

    const row = result.rows[0];

    if (row.consumed_at) {
      throw new VerificationError("Код уже использован. Запросите новый.");
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new VerificationError("Срок действия кода истёк. Запросите новый.");
    }

    if (row.attempts >= row.max_attempts) {
      throw new VerificationError(
        "Превышено число попыток. Запросите новый код."
      );
    }

    const expectedHash = hashCode(identifier, code);
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
