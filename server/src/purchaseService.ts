import { pool } from "./db";

export interface PurchaseResult {
  purchase: {
    id: number;
    userId: number;
    storeId: number;
    amount: string;
    bonusesUsed: string;
    cashbackPercent: string;
    cashbackAmount: string;
    createdAt: Date;
  };

  wallet: {
    id: number;
    userId: number;
    storeId: number;
    balance: string;
  };

  transactions: Array<{
    id: number;
    type: string;
    amount: string;
    balanceAfter: string;
    description: string | null;
    createdAt: Date;
  }>;
}

/**
 * Создать покупку, при необходимости списать бонусы в счёт оплаты,
 * и начислить кешбэк.
 *
 * Оплата бонусами: клиент может оплатить бонусами до 100% покупки —
 * искусственного лимита нет (проверяется только реальный баланс).
 *
 * Кешбэк начисляется ТОЛЬКО с денежной части покупки (amount - bonusesUsed),
 * а не с полной суммы — иначе бонусы генерировали бы новые бонусы по кругу.
 *
 * Всё выполняется внутри одной PostgreSQL-транзакции.
 */
export async function createPurchase(
  userId: number,
  storeId: number,
  amount: number,
  bonusesUsed: number = 0
): Promise<PurchaseResult> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Некорректный ID пользователя");
  }

  if (!Number.isInteger(storeId) || storeId <= 0) {
    throw new Error("Некорректный ID магазина");
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Сумма покупки должна быть положительным целым числом");
  }

  if (!Number.isSafeInteger(bonusesUsed) || bonusesUsed < 0) {
    throw new Error("bonusesUsed должен быть целым числом, не меньше 0");
  }

  if (bonusesUsed > amount) {
    throw new Error("bonusesUsed не может быть больше суммы покупки");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Проверяем, что пользователь подключён к магазину
    const membershipResult = await client.query(
      `
      SELECT 1
      FROM user_stores
      WHERE user_id = $1
        AND store_id = $2
      `,
      [userId, storeId]
    );

    if (membershipResult.rows.length === 0) {
      throw new Error("Пользователь не подключён к этому магазину");
    }

    // 2. Получаем текущий процент кешбэка магазина
    const storeResult = await client.query(
      `
      SELECT
        id,
        cashback_percent
      FROM stores
      WHERE id = $1
        AND is_active = TRUE
      `,
      [storeId]
    );

    if (storeResult.rows.length === 0) {
      throw new Error("Магазин не найден или отключён");
    }

    const cashbackPercent = String(
      storeResult.rows[0].cashback_percent
    );

    /*
     * PostgreSQL NUMERIC(5,2) возвращается как строка.
     *
     * Переводим:
     * 1.00% -> 100
     * 2.50% -> 250
     * 5.00% -> 500
     *
     * Так мы не используем floating point
     * для расчёта денег.
     */
    const cashbackBasisPoints = Math.round(
      Number(cashbackPercent) * 100
    );

    const purchaseAmount = BigInt(amount);
    const bonusesUsedAmount = BigInt(bonusesUsed);

    // Кешбэк — только с денежной части покупки.
    const cashEquivalent = purchaseAmount - bonusesUsedAmount;

    const cashbackAmount =
      (cashEquivalent * BigInt(cashbackBasisPoints)) / 10000n;

    // 3. Создаём wallet, если его ещё нет
    await client.query(
      `
      INSERT INTO wallets (
        user_id,
        store_id,
        balance
      )
      VALUES ($1, $2, 0)
      ON CONFLICT (user_id, store_id)
      DO NOTHING
      `,
      [userId, storeId]
    );

    // 4. Блокируем wallet на время операции
    const walletResult = await client.query(
      `
      SELECT
        id,
        user_id,
        store_id,
        balance
      FROM wallets
      WHERE user_id = $1
        AND store_id = $2
      FOR UPDATE
      `,
      [userId, storeId]
    );

    if (walletResult.rows.length === 0) {
      throw new Error("Кошелёк пользователя не найден");
    }

    const wallet = walletResult.rows[0];

    const currentBalance = BigInt(String(wallet.balance));

    if (bonusesUsedAmount > currentBalance) {
      throw new Error("Недостаточно бонусов для оплаты этой суммы");
    }

    // 5. Создаём покупку
    const purchaseResult = await client.query(
      `
      INSERT INTO purchases (
        user_id,
        store_id,
        amount,
        bonuses_used,
        cashback_percent,
        cashback_amount
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        user_id,
        store_id,
        amount,
        bonuses_used,
        cashback_percent,
        cashback_amount,
        created_at
      `,
      [
        userId,
        storeId,
        amount,
        bonusesUsedAmount.toString(),
        cashbackPercent,
        cashbackAmount.toString(),
      ]
    );

    const purchase = purchaseResult.rows[0];

    // 6. Считаем итоговый баланс: сначала списание бонусов (если есть),
    // затем начисление кешбэка — и сразу пишем итоговое значение в wallet.
    let runningBalance = currentBalance;
    const transactions: PurchaseResult["transactions"] = [];

    if (bonusesUsedAmount > 0n) {
      runningBalance -= bonusesUsedAmount;

      const spendResult = await client.query(
        `
        INSERT INTO wallet_transactions (
          wallet_id,
          type,
          amount,
          balance_after,
          description
        )
        VALUES (
          $1,
          'spend',
          $2,
          $3,
          $4
        )
        RETURNING
          id,
          type,
          amount,
          balance_after,
          description,
          created_at
        `,
        [
          wallet.id,
          bonusesUsedAmount.toString(),
          runningBalance.toString(),
          `Оплата бонусами за покупку #${purchase.id}`,
        ]
      );

      transactions.push({
        id: spendResult.rows[0].id,
        type: spendResult.rows[0].type,
        amount: String(spendResult.rows[0].amount),
        balanceAfter: String(spendResult.rows[0].balance_after),
        description: spendResult.rows[0].description,
        createdAt: spendResult.rows[0].created_at,
      });
    }

    if (cashbackAmount > 0n) {
      runningBalance += cashbackAmount;

      const cashbackResult = await client.query(
        `
        INSERT INTO wallet_transactions (
          wallet_id,
          type,
          amount,
          balance_after,
          description
        )
        VALUES (
          $1,
          'cashback',
          $2,
          $3,
          $4
        )
        RETURNING
          id,
          type,
          amount,
          balance_after,
          description,
          created_at
        `,
        [
          wallet.id,
          cashbackAmount.toString(),
          runningBalance.toString(),
          `Кешбэк за покупку #${purchase.id}`,
        ]
      );

      transactions.push({
        id: cashbackResult.rows[0].id,
        type: cashbackResult.rows[0].type,
        amount: String(cashbackResult.rows[0].amount),
        balanceAfter: String(cashbackResult.rows[0].balance_after),
        description: cashbackResult.rows[0].description,
        createdAt: cashbackResult.rows[0].created_at,
      });
    }

    // 7. Финальное обновление баланса wallet
    const updatedWalletResult = await client.query(
      `
      UPDATE wallets
      SET
        balance = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING
        id,
        user_id,
        store_id,
        balance
      `,
      [
        runningBalance.toString(),
        wallet.id,
      ]
    );

    const updatedWallet = updatedWalletResult.rows[0];

    await client.query("COMMIT");

    return {
      purchase: {
        id: purchase.id,
        userId: purchase.user_id,
        storeId: purchase.store_id,
        amount: String(purchase.amount),
        bonusesUsed: String(purchase.bonuses_used),
        cashbackPercent: String(purchase.cashback_percent),
        cashbackAmount: String(purchase.cashback_amount),
        createdAt: purchase.created_at,
      },

      wallet: {
        id: updatedWallet.id,
        userId: updatedWallet.user_id,
        storeId: updatedWallet.store_id,
        balance: String(updatedWallet.balance),
      },

      transactions,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
