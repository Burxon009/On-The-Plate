import crypto from "crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../src/db";
import {
  setPin,
  verifyPin,
  changePin,
  hasPin,
  PinError,
  PinLockedError,
} from "../src/pinService";

const PIN_PEPPER = process.env.PIN_PEPPER ?? process.env.JWT_SECRET ?? "";

function hashPin(userId: number, pin: string): string {
  return crypto
    .createHmac("sha256", PIN_PEPPER)
    .update(`pin:${userId}:${pin}`)
    .digest("hex");
}

let userId: number;

async function insertSession(): Promise<string> {
  const res = await pool.query(
    `INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at)
     VALUES (gen_random_uuid(), $1, $2, NOW() + INTERVAL '30 days')
     RETURNING id`,
    [userId, crypto.randomBytes(16).toString("hex")]
  );
  return res.rows[0].id;
}

beforeAll(async () => {
  const { rows } = await pool.query("SELECT current_database() AS db");
  if (rows[0].db !== "ucafe_loyalty_test") {
    throw new Error(`Тесты подключены к БД "${rows[0].db}", ожидалась "ucafe_loyalty_test".`);
  }
});

beforeEach(async () => {
  const res = await pool.query(
    `INSERT INTO users (email, name, role) VALUES ($1, 'Pin Tester', 'client') RETURNING id`,
    [`pin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`]
  );
  userId = res.rows[0].id;
});

afterEach(async () => {
  await pool.query("DELETE FROM refresh_sessions WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
});

afterAll(async () => {
  await pool.end();
});

describe("setPin", () => {
  it("хранит хеш, не сам PIN; hasPin становится true", async () => {
    await setPin(userId, "1234");

    const res = await pool.query("SELECT pin_hash FROM users WHERE id = $1", [userId]);
    expect(res.rows[0].pin_hash).toBe(hashPin(userId, "1234"));
    expect(res.rows[0].pin_hash).not.toBe("1234");
    expect(await hasPin(userId)).toBe(true);
  });

  it("отклоняет PIN не из 4 цифр", async () => {
    await expect(setPin(userId, "123")).rejects.toBeInstanceOf(PinError);
    await expect(setPin(userId, "12ab")).rejects.toBeInstanceOf(PinError);
    await expect(setPin(userId, 1234 as unknown)).rejects.toBeInstanceOf(PinError);
    expect(await hasPin(userId)).toBe(false);
  });
});

describe("verifyPin", () => {
  it("проходит на верном PIN", async () => {
    await setPin(userId, "4321");
    await expect(verifyPin(userId, "4321")).resolves.toBeUndefined();
  });

  it("падает, если PIN не установлен", async () => {
    await expect(verifyPin(userId, "0000")).rejects.toThrow("PIN не установлен");
  });

  it("на неверном PIN увеличивает счётчик и сообщает остаток попыток", async () => {
    await setPin(userId, "1111");

    await expect(verifyPin(userId, "2222")).rejects.toThrow("Осталось попыток: 4");

    const res = await pool.query("SELECT pin_failed_attempts FROM users WHERE id = $1", [userId]);
    expect(res.rows[0].pin_failed_attempts).toBe(1);
  });

  it("верный PIN сбрасывает счётчик неудачных попыток", async () => {
    await setPin(userId, "1111");
    await verifyPin(userId, "2222").catch(() => undefined);
    await verifyPin(userId, "2222").catch(() => undefined);

    await verifyPin(userId, "1111");

    const res = await pool.query("SELECT pin_failed_attempts FROM users WHERE id = $1", [userId]);
    expect(res.rows[0].pin_failed_attempts).toBe(0);
  });

  it("5 неверных подряд → блокировка + отзыв всех сессий, дальше PinLockedError", async () => {
    await setPin(userId, "1111");
    const sessionId = await insertSession();

    for (let i = 0; i < 4; i++) {
      await expect(verifyPin(userId, "0000")).rejects.toBeInstanceOf(PinError);
    }
    // 5-я неверная попытка
    await expect(verifyPin(userId, "0000")).rejects.toBeInstanceOf(PinLockedError);

    const user = await pool.query(
      "SELECT pin_locked_until, pin_failed_attempts FROM users WHERE id = $1",
      [userId]
    );
    expect(new Date(user.rows[0].pin_locked_until).getTime()).toBeGreaterThan(Date.now());
    expect(user.rows[0].pin_failed_attempts).toBe(0);

    const session = await pool.query("SELECT revoked_at FROM refresh_sessions WHERE id = $1", [sessionId]);
    expect(session.rows[0].revoked_at).not.toBeNull();

    // Пока блокировка активна — даже верный PIN не проходит.
    await expect(verifyPin(userId, "1111")).rejects.toBeInstanceOf(PinLockedError);
  });
});

describe("changePin", () => {
  it("меняет PIN при верном текущем", async () => {
    await setPin(userId, "1111");

    await changePin(userId, "1111", "2222");

    await expect(verifyPin(userId, "2222")).resolves.toBeUndefined();
    await expect(verifyPin(userId, "1111")).rejects.toBeInstanceOf(PinError);
  });

  it("не меняет PIN при неверном текущем", async () => {
    await setPin(userId, "1111");

    await expect(changePin(userId, "9999", "2222")).rejects.toBeInstanceOf(PinError);
    await expect(verifyPin(userId, "1111")).resolves.toBeUndefined();
  });

  it("отклоняет новый PIN не из 4 цифр", async () => {
    await setPin(userId, "1111");
    await expect(changePin(userId, "1111", "22")).rejects.toBeInstanceOf(PinError);
  });
});
