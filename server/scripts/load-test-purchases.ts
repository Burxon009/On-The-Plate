import "dotenv/config";
import { randomUUID } from "crypto";
import { pool } from "../src/db";
import { createAccessToken } from "../src/sessionService";

/**
 * РАЗОВЫЙ диагностический скрипт (не коммитить).
 *
 * Проверяет защиту от гонки в purchaseService.createPurchase: 50
 * ОДНОВРЕМЕННЫХ POST /purchases на один кошелёк, каждый с уникальным
 * Idempotency-Key. Если FOR UPDATE-блокировка строки кошелька работает —
 * итоговый баланс = ровно сумма кешбэка 50 покупок. Если где-то потеряна
 * покупка (lost update) — баланс будет меньше.
 */

const BASE = "http://localhost:3000";
const N = 50;
const AMOUNT = 1000;
const STORE_ID = 1;

async function main() {
  // 1. Админ магазина 1 (единственный admin, user id=2) — минтим токен.
  const adminRow = await pool.query(
    `SELECT sa.user_id FROM store_admins sa WHERE sa.store_id = $1 LIMIT 1`,
    [STORE_ID]
  );
  if (adminRow.rows.length === 0) throw new Error(`У магазина ${STORE_ID} нет admin в store_admins`);
  const adminId: number = adminRow.rows[0].user_id;
  const adminToken = createAccessToken({ id: adminId, role: "admin" });

  const storeRow = await pool.query(`SELECT cashback_percent FROM stores WHERE id = $1`, [STORE_ID]);
  const cashbackPercent = Number(storeRow.rows[0].cashback_percent);

  // 2. Свежий тестовый клиент, подключённый к магазину 1, кошелёк = 0.
  const clientRow = await pool.query(
    `INSERT INTO users (name, role) VALUES ('LoadTest Purchases Client', 'client') RETURNING id, qr_token`
  );
  const clientId: number = clientRow.rows[0].id;
  const qrToken: string = clientRow.rows[0].qr_token;
  await pool.query(`INSERT INTO user_stores (user_id, store_id) VALUES ($1, $2)`, [clientId, STORE_ID]);

  // Ожидаемый кешбэк за 1 покупку (та же basis-points математика, что в purchaseService).
  const bp = Math.round(cashbackPercent * 100); // 1.00% -> 100
  const cashbackPerPurchase = Math.trunc((AMOUNT * bp) / 10000); // (1000*100)/10000 = 10
  const expectedBalance = cashbackPerPurchase * N;

  console.log(`admin id=${adminId}, client id=${clientId}, store=${STORE_ID}, cashback=${cashbackPercent}%`);
  console.log(`${N} параллельных покупок по ${AMOUNT}; ожидаемый кешбэк/покупку=${cashbackPerPurchase}; ожидаемый итоговый баланс=${expectedBalance}`);

  // 3. Одновременный залп из N запросов, каждый со своим Idempotency-Key.
  const started = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: N }, () =>
      fetch(`${BASE}/purchases`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
          "Idempotency-Key": `loadtest-${randomUUID()}`,
        },
        body: JSON.stringify({ qrToken, storeId: STORE_ID, amount: AMOUNT }),
      }).then(async (r) => ({ status: r.status, body: await r.text() }))
    )
  );
  const elapsedMs = Date.now() - started;

  let ok = 0;
  const failures: string[] = [];
  for (const res of results) {
    if (res.status === "fulfilled" && res.value.status === 201) ok += 1;
    else if (res.status === "fulfilled") failures.push(`HTTP ${res.value.status}: ${res.value.body.slice(0, 160)}`);
    else failures.push(`network: ${String(res.reason).slice(0, 160)}`);
  }

  // 4. Реальное состояние в БД.
  const walletRow = await pool.query(
    `SELECT balance FROM wallets WHERE user_id = $1 AND store_id = $2`,
    [clientId, STORE_ID]
  );
  const actualBalance = walletRow.rows[0] ? Number(walletRow.rows[0].balance) : 0;
  const purchaseCount = Number(
    (await pool.query(`SELECT count(*)::int AS c FROM purchases WHERE user_id = $1 AND store_id = $2`, [clientId, STORE_ID])).rows[0].c
  );
  const cashbackTxCount = Number(
    (
      await pool.query(
        `SELECT count(*)::int AS c FROM wallet_transactions t
         JOIN wallets w ON w.id = t.wallet_id
         WHERE w.user_id = $1 AND w.store_id = $2 AND t.type = 'cashback'`,
        [clientId, STORE_ID]
      )
    ).rows[0].c
  );

  console.log("\n================ РЕЗУЛЬТАТ ================");
  console.log(`время залпа:            ${elapsedMs} ms`);
  console.log(`успешных (201):         ${ok} / ${N}`);
  console.log(`ошибок:                 ${failures.length}`);
  for (const f of failures.slice(0, 10)) console.log(`  - ${f}`);
  console.log(`покупок в БД:           ${purchaseCount}`);
  console.log(`cashback-транзакций:    ${cashbackTxCount}`);
  console.log(`баланс кошелька:        ${actualBalance}`);
  console.log(`ожидаемый баланс:       ${expectedBalance}  (= ${ok} успешных × ${cashbackPerPurchase})`);
  const expectedForOk = ok * cashbackPerPurchase;
  console.log(
    actualBalance === expectedForOk
      ? `✅ БАЛАНС СХОДИТСЯ с числом успешных покупок — потерь/дублей под нагрузкой НЕТ`
      : `❌ РАСХОЖДЕНИЕ: баланс ${actualBalance}, а по ${ok} успешным покупкам должно быть ${expectedForOk}`
  );

  // 5. Чистка.
  await pool.query(`DELETE FROM users WHERE id = $1`, [clientId]); // CASCADE уберёт wallet/tx/purchases/user_stores
  const leftover = Number(
    (await pool.query(`SELECT count(*)::int AS c FROM users WHERE id = $1`, [clientId])).rows[0].c
  );
  console.log(`\nтестовый клиент удалён: ${leftover === 0 ? "да" : "НЕТ (осталось " + leftover + ")"}`);

  await pool.end();
}

main().catch(async (e) => {
  console.error("Скрипт упал:", e);
  await pool.end();
  process.exit(1);
});
