import crypto from "crypto";
import { pool } from "./db";
import { emailService } from "./emailService";
import {
  sendVerificationMessage,
  checkVerificationStatus,
  TelegramGatewayError,
} from "./telegramGatewayService";

const CODE_TTL_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;
// Первые N запросов кода (за окно ниже) — без задержки: холодный старт
// сервера (Render free) может «съесть» единственную попытку, клиент по
// таймауту думает, что не отправилось, и жмёт ещё раз. После N-го — пауза
// RESEND_COOLDOWN_SECONDS между запросами.
const FREE_ATTEMPTS_BEFORE_COOLDOWN = 3;
const ATTEMPT_WINDOW_MINUTES = 15;

// Простая, но рабочая проверка формата email.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Телефон в формате E.164: «+» и 8–15 цифр, первая — не ноль.
const PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

const CODE_PEPPER = process.env.CODE_PEPPER ?? process.env.JWT_SECRET ?? "";

if (!CODE_PEPPER) {
  throw new Error("CODE_PEPPER (или JWT_SECRET) не задан в .env");
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && EMAIL_REGEX.test(email);
}

export function isValidPhone(phone: unknown): phone is string {
  return typeof phone === "string" && PHONE_REGEX.test(normalizePhone(phone));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Приводит телефон к каноническому E.164: только «+» и цифры.
 * Пробелы, дефисы, скобки убираются — чтобы номер, сохранённый через
 * профиль («+998 88 852 09 06»), совпадал при поиске с номером входа
 * («+998888520906»). Именно в этом виде телефон лежит в users.phone
 * и в verification_codes.identifier.
 */
export function normalizePhone(phone: string): string {
  return `+${phone.replace(/\D/g, "")}`;
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

/**
 * Политика повторной отправки кода: первые FREE_ATTEMPTS_BEFORE_COOLDOWN
 * запросов за ATTEMPT_WINDOW_MINUTES — сразу, дальше — не чаще раза в
 * RESEND_COOLDOWN_SECONDS. Бросает VerificationError, если нужно подождать.
 */
async function enforceResendPolicy(identifier: string): Promise<void> {
  const recent = await pool.query(
    `
    SELECT created_at
    FROM verification_codes
    WHERE identifier = $1
      AND created_at > NOW() - make_interval(mins => $2)
    ORDER BY created_at DESC
    `,
    [identifier, ATTEMPT_WINDOW_MINUTES]
  );

  if (recent.rows.length < FREE_ATTEMPTS_BEFORE_COOLDOWN) return;

  const lastCreatedAt = new Date(recent.rows[0].created_at);
  const secondsSinceLast = (Date.now() - lastCreatedAt.getTime()) / 1000;

  if (secondsSinceLast < RESEND_COOLDOWN_SECONDS) {
    const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLast);
    throw new VerificationError(
      `Слишком много запросов кода подряд. Следующий — через ${wait} сек.`
    );
  }
}

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

  await enforceResendPolicy(identifier);

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

/* ─────────────────────────────────────────────────────────────────────
 * ТЕЛЕФОН — через Telegram Gateway.
 *
 * Отличие от email: код генерирует и проверяет САМ Telegram. Мы храним
 * в verification_codes только `request_id` (code_hash = NULL) и общий
 * cooldown/expiry, а валидность кода спрашиваем у Telegram.
 * ──────────────────────────────────────────────────────────────────── */

/** Запросить код подтверждения на телефон (Telegram Gateway). */
export async function requestPhoneVerificationCode(phone: string): Promise<void> {
  if (!isValidPhone(phone)) {
    throw new VerificationError("Некорректный номер телефона");
  }

  const identifier = normalizePhone(phone);

  await enforceResendPolicy(identifier);

  let requestId: string;
  try {
    const status = await sendVerificationMessage(identifier, {
      ttlSeconds: CODE_TTL_MINUTES * 60,
    });
    requestId = status.request_id;
  } catch (error) {
    if (error instanceof TelegramGatewayError) {
      throw new VerificationError(
        "Не удалось отправить код в Telegram. Проверьте номер и попробуйте ещё раз."
      );
    }
    throw error;
  }

  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await pool.query(
    `
    INSERT INTO verification_codes (identifier, request_id, expires_at)
    VALUES ($1, $2, $3)
    `,
    [identifier, requestId, expiresAt]
  );
}

/**
 * Проверить код с телефона. Валидность кода определяет Telegram
 * (verification_status). Наши локальные проверки — только «код запрошен»,
 * «не использован», «не истёк».
 */
export async function verifyPhoneCode(
  phone: string,
  code: string
): Promise<void> {
  if (!isValidPhone(phone)) {
    throw new VerificationError("Некорректный номер телефона");
  }

  if (typeof code !== "string" || !/^\d{4,8}$/.test(code)) {
    throw new VerificationError("Код должен состоять из 4–8 цифр");
  }

  const identifier = normalizePhone(phone);

  const result = await pool.query(
    `
    SELECT id, request_id, expires_at, consumed_at
    FROM verification_codes
    WHERE identifier = $1 AND request_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [identifier]
  );

  if (result.rows.length === 0) {
    throw new VerificationError(
      "Код не запрошен для этого номера. Сначала запросите код."
    );
  }

  const row = result.rows[0];

  if (row.consumed_at) {
    throw new VerificationError("Код уже использован. Запросите новый.");
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new VerificationError("Срок действия кода истёк. Запросите новый.");
  }

  let status;
  try {
    status = await checkVerificationStatus(row.request_id, code);
  } catch (error) {
    if (error instanceof TelegramGatewayError) {
      throw new VerificationError("Не удалось проверить код. Попробуйте ещё раз.");
    }
    throw error;
  }

  const verificationStatus = status.verification_status?.status;

  if (verificationStatus === "code_valid") {
    await pool.query(
      `UPDATE verification_codes SET consumed_at = NOW() WHERE id = $1`,
      [row.id]
    );
    return;
  }

  if (verificationStatus === "code_max_attempts_exceeded") {
    throw new VerificationError(
      "Превышено число попыток. Запросите новый код."
    );
  }

  if (verificationStatus === "expired") {
    throw new VerificationError("Срок действия кода истёк. Запросите новый.");
  }

  // code_invalid или код ещё не введён на стороне Telegram
  throw new VerificationError("Неверный код. Попробуйте ещё раз.");
}
