import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db";
import { createPurchase } from "../src/purchaseService";

// Предохранитель: тесты делают TRUNCATE, поэтому убеждаемся, что pool
// подключён именно к тестовой БД, а не к рабочей.
beforeAll(async () => {
  const { rows } = await pool.query("SELECT current_database() AS db");
  if (rows[0].db !== "ucafe_loyalty_test") {
    throw new Error(
      `Тесты подключены к БД "${rows[0].db}", ожидалась "ucafe_loyalty_test". Прерываю, чтобы не тронуть рабочие данные.`
    );
  }
});

/**
 * Тесты идут против реальной PostgreSQL (ucafe_loyalty_test, поднимается
 * в test/globalSetup.ts). Вся логика createPurchase построена на SQL-
 * транзакции с FOR UPDATE и BigInt/basis points — моки БД такое не ловят.
 */

interface Seed {
  cashbackPercent?: number;
  balance?: number;
}

async function seed({ cashbackPercent = 5, balance = 0 }: Seed = {}) {
  const store = await pool.query(
    `INSERT INTO stores (name, cashback_percent, is_active)
     VALUES ('Test Store', $1, TRUE) RETURNING id`,
    [cashbackPercent]
  );
  const storeId: number = store.rows[0].id;

  const user = await pool.query(
    `INSERT INTO users (name) VALUES ('Test Client') RETURNING id`
  );
  const userId: number = user.rows[0].id;

  await pool.query(
    `INSERT INTO user_stores (user_id, store_id) VALUES ($1, $2)`,
    [userId, storeId]
  );

  if (balance > 0) {
    await pool.query(
      `INSERT INTO wallets (user_id, store_id, balance) VALUES ($1, $2, $3)`,
      [userId, storeId, balance]
    );
  }

  return { userId, storeId };
}

async function walletBalance(userId: number, storeId: number): Promise<string | null> {
  const res = await pool.query(
    `SELECT balance FROM wallets WHERE user_id = $1 AND store_id = $2`,
    [userId, storeId]
  );
  return res.rows[0] ? String(res.rows[0].balance) : null;
}

async function purchaseCount(): Promise<number> {
  const res = await pool.query(`SELECT COUNT(*)::int AS c FROM purchases`);
  return res.rows[0].c;
}

afterEach(async () => {
  // CASCADE подчищает wallets / wallet_transactions / purchases / user_stores.
  await pool.query("TRUNCATE users, stores RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("createPurchase", () => {
  it("начисляет кешбэк по проценту магазина на обычную покупку без бонусов", async () => {
    const { userId, storeId } = await seed({ cashbackPercent: 5 });

    const res = await createPurchase(userId, storeId, 10_000);

    expect(res.purchase.cashbackAmount).toBe("500"); // 5% от 10000
    expect(res.purchase.bonusesUsed).toBe("0");
    expect(res.wallet.balance).toBe("500");
    expect(res.transactions).toHaveLength(1);
    expect(res.transactions[0].type).toBe("cashback");
    expect(res.transactions[0].amount).toBe("500");
    expect(await walletBalance(userId, storeId)).toBe("500");
  });

  it("считает кешбэк только с денежной части (amount - bonusesUsed), не с полной суммы", async () => {
    const { userId, storeId } = await seed({ cashbackPercent: 10, balance: 3_000 });

    const res = await createPurchase(userId, storeId, 10_000, 2_000);

    // Денежная часть = 8000, 10% = 800 (НЕ 1000 с полной суммы).
    expect(res.purchase.cashbackAmount).toBe("800");
    expect(res.purchase.bonusesUsed).toBe("2000");
    // 3000 − 2000 (списание) + 800 (кешбэк) = 1800
    expect(res.wallet.balance).toBe("1800");
    expect(res.transactions.map((t) => t.type)).toEqual(["spend", "cashback"]);
    expect(await walletBalance(userId, storeId)).toBe("1800");
  });

  it("падает с 'Недостаточно бонусов', если бонусов на балансе меньше, чем хотят списать", async () => {
    const { userId, storeId } = await seed({ cashbackPercent: 5, balance: 1_000 });

    await expect(
      createPurchase(userId, storeId, 10_000, 5_000)
    ).rejects.toThrow("Недостаточно бонусов для оплаты этой суммы");

    // Транзакция откатилась: ни покупки, ни изменения баланса.
    expect(await purchaseCount()).toBe(0);
    expect(await walletBalance(userId, storeId)).toBe("1000");
  });

  it("падает, если бонусами пытаются оплатить больше суммы покупки", async () => {
    const { userId, storeId } = await seed({ cashbackPercent: 5, balance: 100_000 });

    await expect(
      createPurchase(userId, storeId, 10_000, 15_000)
    ).rejects.toThrow("bonusesUsed не может быть больше суммы покупки");

    expect(await purchaseCount()).toBe(0);
    expect(await walletBalance(userId, storeId)).toBe("100000");
  });

  it("повторный вызов с тем же idempotencyKey не создаёт вторую покупку и не удваивает списание", async () => {
    const { userId, storeId } = await seed({ cashbackPercent: 5 });
    const key = "idem-key-abcdef123456";

    const first = await createPurchase(userId, storeId, 10_000, 0, key);
    expect(first.wallet.balance).toBe("500");

    // На уровне сервиса повтор ключа = нарушение UNIQUE-индекса
    // purchases_idempotency_key_idx (код 23505). Возврат исходного
    // результата с { idempotentReplay: true } — это уже слой роутинга
    // (purchaseRoutes.ts ловит 23505 и перечитывает покупку).
    await expect(
      createPurchase(userId, storeId, 10_000, 0, key)
    ).rejects.toMatchObject({ code: "23505" });

    const dup = await pool.query(
      `SELECT COUNT(*)::int AS c FROM purchases WHERE idempotency_key = $1`,
      [key]
    );
    expect(dup.rows[0].c).toBe(1);
    // Баланс не 1000 — второе начисление не прошло.
    expect(await walletBalance(userId, storeId)).toBe("500");
  });
});
