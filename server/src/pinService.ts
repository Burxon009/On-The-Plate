import crypto from "crypto";
import { pool } from "./db";
import { revokeAllSessionsForUser } from "./sessionService";

/**
 * PIN-код быстрой разблокировки. НЕ способ входа — только "замок" поверх
 * уже активной 30-дневной сессии. Хеш считается тем же приёмом, что и коды
 * подтверждения: HMAC-SHA256 с server-side pepper, в открытом виде PIN
 * нигде не хранится и не логируется.
 */

const PIN_PEPPER = process.env.PIN_PEPPER ?? process.env.JWT_SECRET ?? "";

if (!PIN_PEPPER) {
  throw new Error("PIN_PEPPER (или JWT_SECRET) не задан в .env");
}

/** 5 неверных PIN подряд → блокировка + полный вход заново. */
const MAX_ATTEMPTS = 5;
/** На сколько блокируется PIN после серии неверных попыток. */
const LOCK_MINUTES = 15;

const PIN_REGEX = /^\d{4}$/;

export class PinError extends Error {}

/** Кинута, когда PIN заблокирован и требуется полный вход через email/SMS. */
export class PinLockedError extends PinError {
  constructor(message = "Слишком много неверных попыток. Войдите заново через email или номер телефона.") {
    super(message);
  }
}

export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_REGEX.test(pin);
}

function hashPin(userId: number, pin: string): string {
  return crypto
    .createHmac("sha256", PIN_PEPPER)
    .update(`pin:${userId}:${pin}`)
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Установлен ли у пользователя PIN. */
export async function hasPin(userId: number): Promise<boolean> {
  const result = await pool.query(
    "SELECT pin_hash FROM users WHERE id = $1",
    [userId]
  );
  return Boolean(result.rows[0]?.pin_hash);
}

/**
 * Установить (или перезаписать) PIN. Сбрасывает счётчик неудачных попыток
 * и снимает блокировку. Требует уже авторизованного пользователя — вызов
 * защищён authMiddleware на уровне маршрута.
 */
export async function setPin(userId: number, pin: unknown): Promise<void> {
  if (!isValidPinFormat(pin)) {
    throw new PinError("PIN должен состоять из 4 цифр");
  }

  await pool.query(
    `UPDATE users
        SET pin_hash = $1,
            pin_failed_attempts = 0,
            pin_locked_until = NULL,
            updated_at = NOW()
      WHERE id = $2`,
    [hashPin(userId, pin), userId]
  );
}

/**
 * Сменить PIN: сверяет текущий, затем ставит новый. Неверный текущий PIN
 * идёт через ту же логику попыток/блокировки, что и обычная разблокировка.
 */
export async function changePin(
  userId: number,
  currentPin: unknown,
  newPin: unknown
): Promise<void> {
  if (!isValidPinFormat(newPin)) {
    throw new PinError("Новый PIN должен состоять из 4 цифр");
  }
  await verifyPin(userId, currentPin);
  await setPin(userId, newPin);
}

/**
 * Проверить PIN и разблокировать интерфейс.
 *
 * - блокировка активна        → PinLockedError (нужен полный вход)
 * - неверный PIN, попыток < 5  → PinError со счётчиком оставшихся попыток
 * - неверный PIN, попытка 5    → блокировка на 15 мин + отзыв всех сессий
 * - верный PIN                 → счётчик и блокировка сбрасываются
 */
export async function verifyPin(userId: number, pin: unknown): Promise<void> {
  if (!isValidPinFormat(pin)) {
    throw new PinError("PIN должен состоять из 4 цифр");
  }

  const client = await pool.connect();
  let lockedOut = false;
  let resultError: PinError | null = null;

  try {
    await client.query("BEGIN");

    const res = await client.query(
      `SELECT pin_hash, pin_failed_attempts, pin_locked_until
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [userId]
    );

    const row = res.rows[0];

    if (!row || !row.pin_hash) {
      throw new PinError("PIN не установлен");
    }

    if (
      row.pin_locked_until &&
      new Date(row.pin_locked_until).getTime() > Date.now()
    ) {
      throw new PinLockedError();
    }

    if (safeEqualHex(hashPin(userId, pin), row.pin_hash)) {
      await client.query(
        `UPDATE users
            SET pin_failed_attempts = 0, pin_locked_until = NULL
          WHERE id = $1`,
        [userId]
      );
      await client.query("COMMIT");
      return;
    }

    const attempts = row.pin_failed_attempts + 1;

    if (attempts >= MAX_ATTEMPTS) {
      await client.query(
        `UPDATE users
            SET pin_failed_attempts = 0,
                pin_locked_until = NOW() + make_interval(mins => $2)
          WHERE id = $1`,
        [userId, LOCK_MINUTES]
      );
      await revokeAllSessionsForUser(client, userId);
      await client.query("COMMIT");
      lockedOut = true;
    } else {
      await client.query(
        `UPDATE users SET pin_failed_attempts = $2 WHERE id = $1`,
        [userId, attempts]
      );
      await client.query("COMMIT");
      resultError = new PinError(
        `Неверный PIN. Осталось попыток: ${MAX_ATTEMPTS - attempts}`
      );
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (lockedOut) throw new PinLockedError();
  if (resultError) throw resultError;
}
