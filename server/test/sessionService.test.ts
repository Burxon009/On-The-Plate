import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { pool } from "../src/db";
import {
  createRefreshSession,
  rotateRefreshSession,
} from "../src/sessionService";

beforeAll(async () => {
  const { rows } = await pool.query("SELECT current_database() AS db");
  if (rows[0].db !== "ucafe_loyalty_test") {
    throw new Error(`Тесты подключены к БД "${rows[0].db}", ожидалась "ucafe_loyalty_test". Прерываю.`);
  }
});

async function seedUser(): Promise<number> {
  const res = await pool.query(`INSERT INTO users (name, role) VALUES ('U', 'client') RETURNING id`);
  return res.rows[0].id;
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function activeSessionCount(userId: number): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS c FROM refresh_sessions WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  return res.rows[0].c;
}

afterEach(async () => {
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE"); // CASCADE чистит refresh_sessions
});

afterAll(async () => {
  await pool.end();
});

describe("createRefreshSession", () => {
  it("создаёт запись с хешем токена, а не самим токеном", async () => {
    const userId = await seedUser();

    const token = await withClient((c) =>
      createRefreshSession(c, userId, { ip: "10.0.0.1", userAgent: "vitest-UA" })
    );

    const res = await pool.query(`SELECT * FROM refresh_sessions WHERE user_id = $1`, [userId]);
    expect(res.rows).toHaveLength(1);

    const row = res.rows[0];
    expect(token).toContain("."); // "<sessionId>.<secret>"
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.token_hash).not.toBe(token);
    expect(token.startsWith(row.id)).toBe(true); // id таблицы = sessionId из токена
    expect(row.revoked_at).toBeNull();
    expect(row.ip_address).toBe("10.0.0.1");
    expect(row.user_agent).toBe("vitest-UA");
  });
});

describe("rotateRefreshSession", () => {
  it("ротация валидного токена: старый отзывается, новый создаётся", async () => {
    const userId = await seedUser();
    const oldToken = await withClient((c) => createRefreshSession(c, userId, {}));
    const oldRow = (await pool.query(`SELECT id FROM refresh_sessions WHERE user_id = $1`, [userId])).rows[0];

    const rotated = await withClient((c) => rotateRefreshSession(c, oldToken, {}));

    expect(rotated).not.toBeNull();
    expect(rotated!.user.id).toBe(userId);
    expect(rotated!.refreshToken).not.toBe(oldToken);

    const old = (
      await pool.query(`SELECT revoked_at, replaced_by FROM refresh_sessions WHERE id = $1`, [oldRow.id])
    ).rows[0];
    expect(old.revoked_at).not.toBeNull();
    expect(old.replaced_by).not.toBeNull();

    // Всего 2 сессии, активна ровно одна (новая).
    const all = await pool.query(`SELECT id FROM refresh_sessions WHERE user_id = $1`, [userId]);
    expect(all.rows).toHaveLength(2);
    expect(await activeSessionCount(userId)).toBe(1);
  });

  it("повторное предъявление уже отозванного токена проваливается и гасит ВСЕ сессии пользователя (защита от кражи)", async () => {
    const userId = await seedUser();
    const oldToken = await withClient((c) => createRefreshSession(c, userId, {}));

    // Легитимная ротация — oldToken теперь revoked + replaced_by.
    const first = await withClient((c) => rotateRefreshSession(c, oldToken, {}));
    expect(first).not.toBeNull();
    expect(await activeSessionCount(userId)).toBe(1);

    // Злоумышленник предъявляет украденный старый токен ещё раз.
    const reuse = await withClient((c) => rotateRefreshSession(c, oldToken, {}));
    expect(reuse).toBeNull();

    // Reuse-detection: активных сессий не осталось вообще, даже свежая погашена.
    expect(await activeSessionCount(userId)).toBe(0);
  });

  it("полностью выдуманный токен проваливается", async () => {
    const result = await withClient((c) =>
      rotateRefreshSession(c, "00000000-0000-0000-0000-000000000000.deadbeef", {})
    );
    expect(result).toBeNull();
  });
});
