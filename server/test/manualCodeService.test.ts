import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db";
import { assignManualCode } from "../src/manualCodeService";

beforeAll(async () => {
  const { rows } = await pool.query("SELECT current_database() AS db");
  if (rows[0].db !== "ucafe_loyalty_test") {
    throw new Error(`Тесты подключены к БД "${rows[0].db}", ожидалась "ucafe_loyalty_test".`);
  }
});

afterEach(async () => {
  await pool.query(
    "TRUNCATE users, stores, store_manual_code_counters RESTART IDENTITY CASCADE"
  );
});

afterAll(async () => {
  await pool.end();
});

async function makeStore(name: string): Promise<number> {
  const r = await pool.query(
    `INSERT INTO stores (name, is_active) VALUES ($1, TRUE) RETURNING id`,
    [name]
  );
  return r.rows[0].id;
}

/** Подключает нового клиента к магазину и присваивает код (как /join). */
async function join(storeId: number): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query(
      `INSERT INTO users (name) VALUES ('C') RETURNING id`
    );
    const link = await client.query(
      `INSERT INTO user_stores (user_id, store_id) VALUES ($1, $2) RETURNING id`,
      [user.rows[0].id, storeId]
    );
    const code = await assignManualCode(client, storeId, link.rows[0].id);
    await client.query("COMMIT");
    return code;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

describe("assignManualCode", () => {
  it("нумерует с 1 и по возрастанию внутри магазина", async () => {
    const store = await makeStore("A");
    expect(await join(store)).toBe(1);
    expect(await join(store)).toBe(2);
    expect(await join(store)).toBe(3);
  });

  it("нумерация независима для разных магазинов", async () => {
    const a = await makeStore("A");
    const b = await makeStore("B");

    expect(await join(a)).toBe(1);
    expect(await join(a)).toBe(2);
    expect(await join(b)).toBe(1); // у второго магазина своя нумерация
    expect(await join(a)).toBe(3);
    expect(await join(b)).toBe(2);
  });

  it("код записан в user_stores и уникален в пределах магазина", async () => {
    const store = await makeStore("A");
    await join(store);
    await join(store);

    const codes = await pool.query(
      `SELECT manual_code FROM user_stores WHERE store_id = $1 ORDER BY manual_code`,
      [store]
    );
    expect(codes.rows.map((r) => r.manual_code)).toEqual([1, 2]);

    // повторная вставка того же кода в тот же магазин — запрещена индексом
    await expect(
      pool.query(
        `INSERT INTO user_stores (user_id, store_id, manual_code)
         VALUES ((SELECT id FROM users LIMIT 1), $1, 1)`,
        [store]
      )
    ).rejects.toThrow();
  });

  it("параллельные подключения к одному магазину получают разные коды", async () => {
    const store = await makeStore("A");
    const results = await Promise.all(
      Array.from({ length: 10 }, () => join(store))
    );
    expect([...results].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
