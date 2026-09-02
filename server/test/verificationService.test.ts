import crypto from "crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Заглушаем реальную отправку писем — тесты не должны слать почту.
vi.mock("../src/emailService", () => ({
  emailService: { sendEmail: vi.fn().mockResolvedValue(undefined) },
}));

import { pool } from "../src/db";
import { emailService } from "../src/emailService";
import { requestVerificationCode, verifyCode } from "../src/verificationService";

const CODE_PEPPER = process.env.CODE_PEPPER ?? process.env.JWT_SECRET ?? "";

function hashCode(identifier: string, code: string): string {
  return crypto.createHmac("sha256", CODE_PEPPER).update(`${identifier}:${code}`).digest("hex");
}

/** Кладём код в БД напрямую с известным plaintext — verifyCode проверяем изолированно. */
async function insertCode(
  rawEmail: string,
  code: string,
  opts: { expiresInMs?: number; attempts?: number; consumed?: boolean; createdAgoMs?: number } = {}
): Promise<number> {
  const identifier = rawEmail.trim().toLowerCase();
  const { expiresInMs = 5 * 60 * 1000, attempts = 0, consumed = false, createdAgoMs = 0 } = opts;
  const res = await pool.query(
    `INSERT INTO verification_codes (identifier, code_hash, expires_at, attempts, consumed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      identifier,
      hashCode(identifier, code),
      new Date(Date.now() + expiresInMs),
      attempts,
      consumed ? new Date() : null,
      new Date(Date.now() - createdAgoMs),
    ]
  );
  return res.rows[0].id;
}

beforeAll(async () => {
  const { rows } = await pool.query("SELECT current_database() AS db");
  if (rows[0].db !== "ucafe_loyalty_test") {
    throw new Error(`Тесты подключены к БД "${rows[0].db}", ожидалась "ucafe_loyalty_test". Прерываю.`);
  }
});

afterEach(async () => {
  await pool.query("TRUNCATE verification_codes RESTART IDENTITY");
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
});

describe("requestVerificationCode", () => {
  it("создаёт код в БД (хеш, не сам код) с TTL 5 минут", async () => {
    await requestVerificationCode("Test@Example.com");

    const res = await pool.query("SELECT * FROM verification_codes WHERE identifier = $1", ["test@example.com"]);
    expect(res.rows).toHaveLength(1);

    const row = res.rows[0];
    expect(row.code_hash).toMatch(/^[a-f0-9]{64}$/); // HMAC-SHA256 hex
    expect(row.code_hash).not.toMatch(/^\d{6}$/); // не сырой код

    // TTL считаем как expires_at − created_at (не зависит от таймзоны колонки).
    const ttlMs = new Date(row.expires_at).getTime() - new Date(row.created_at).getTime();
    expect(ttlMs).toBeGreaterThan(4 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60 * 1000 + 2000);

    expect(emailService.sendEmail).toHaveBeenCalledOnce();
  });

  it("падает на некорректном email", async () => {
    await expect(requestVerificationCode("не-email")).rejects.toThrow("Некорректный email");
    const res = await pool.query("SELECT COUNT(*)::int AS c FROM verification_codes");
    expect(res.rows[0].c).toBe(0);
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it("первые 3 запроса подряд проходят без задержки (страховка от холодного старта)", async () => {
    await requestVerificationCode("user@example.com");
    await requestVerificationCode("user@example.com");
    await requestVerificationCode("user@example.com");

    const res = await pool.query("SELECT COUNT(*)::int AS c FROM verification_codes");
    expect(res.rows[0].c).toBe(3);
    expect(emailService.sendEmail).toHaveBeenCalledTimes(3);
  });

  it("после 3 запросов включается cooldown 60 сек", async () => {
    await requestVerificationCode("user@example.com");
    await requestVerificationCode("user@example.com");
    await requestVerificationCode("user@example.com");

    await expect(requestVerificationCode("user@example.com")).rejects.toThrow(
      /через \d+ сек/
    );
    // Четвёртый код не создан, четвёртое письмо не ушло.
    const res = await pool.query("SELECT COUNT(*)::int AS c FROM verification_codes");
    expect(res.rows[0].c).toBe(3);
    expect(emailService.sendEmail).toHaveBeenCalledTimes(3);
  });
});

describe("verifyCode", () => {
  it("проходит на правильном коде и помечает код использованным", async () => {
    await insertCode("client@example.com", "123456");

    await expect(verifyCode("client@example.com", "123456")).resolves.toBeUndefined();

    const res = await pool.query("SELECT consumed_at FROM verification_codes WHERE identifier = $1", [
      "client@example.com",
    ]);
    expect(res.rows[0].consumed_at).not.toBeNull();
  });

  it("падает на неправильном коде и увеличивает счётчик попыток", async () => {
    const id = await insertCode("client@example.com", "123456");

    await expect(verifyCode("client@example.com", "000000")).rejects.toThrow(/Неверный код/);

    const res = await pool.query("SELECT attempts FROM verification_codes WHERE id = $1", [id]);
    expect(res.rows[0].attempts).toBe(1);
  });

  it("падает с ошибкой про истёкший срок, если TTL прошёл", async () => {
    await insertCode("client@example.com", "123456", { expiresInMs: -1000 });

    await expect(verifyCode("client@example.com", "123456")).rejects.toThrow("Срок действия кода истёк");
  });

  it("не даёт использовать один и тот же код повторно", async () => {
    await insertCode("client@example.com", "123456");

    await verifyCode("client@example.com", "123456"); // первый раз — ок
    await expect(verifyCode("client@example.com", "123456")).rejects.toThrow("Код уже использован");
  });
});
