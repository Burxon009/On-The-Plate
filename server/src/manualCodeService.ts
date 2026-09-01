import { PoolClient } from "pg";

/**
 * Присваивает связи клиент↔магазин ($userStoreId) следующий свободный
 * короткий код В ПРЕДЕЛАХ магазина ($storeId) и возвращает его.
 *
 * Вызывать ВНУТРИ открытой транзакции ($client в BEGIN). UPDATE счётчика
 * берёт блокировку строки, поэтому параллельные подключения к одному
 * магазину сериализуются и не получают одинаковый код.
 */
export async function assignManualCode(
  client: PoolClient,
  storeId: number,
  userStoreId: number
): Promise<number> {
  // Первый клиент магазина создаёт счётчик (next_code = 2) и получает код 1.
  const created = await client.query(
    `
    INSERT INTO store_manual_code_counters (store_id, next_code)
    VALUES ($1, 2)
    ON CONFLICT (store_id) DO NOTHING
    RETURNING store_id
    `,
    [storeId]
  );

  let assignedCode: number;
  if (created.rows.length > 0) {
    assignedCode = 1;
  } else {
    const bumped = await client.query(
      `
      UPDATE store_manual_code_counters
         SET next_code = next_code + 1
       WHERE store_id = $1
      RETURNING next_code - 1 AS assigned_code
      `,
      [storeId]
    );
    assignedCode = bumped.rows[0].assigned_code;
  }

  await client.query(
    `UPDATE user_stores SET manual_code = $1 WHERE id = $2`,
    [assignedCode, userStoreId]
  );

  return assignedCode;
}
