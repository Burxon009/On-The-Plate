import { pool } from "./db";

export interface PurchaseResult {
  purchase: {
    id: number;
    userId: number;
    storeId: number;
    amount: string;
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

  transaction: {
    id: number;
    type: string;
    amount: string;
    balanceAfter: string;
    description: string | null;
    createdAt: Date;
  };
}

/**
 * Создать покупку и начислить кешбэк.
 *
 * Всё выполняется внутри одной PostgreSQL-транзакции.
 */
export async function createPurchase(
  userId: number,
  storeId: number,
  amount: number
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

    const cashbackAmount =
      (purchaseAmount * BigInt(cashbackBasisPoints)) / 10000n;

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
    const newBalance = currentBalance + cashbackAmount;

    // 5. Создаём покупку
    const purchaseResult = await client.query(
      `
      INSERT INTO purchases (
        user_id,
        store_id,
        amount,
        cashback_percent,
        cashback_amount
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        user_id,
        store_id,
        amount,
        cashback_percent,
        cashback_amount,
        created_at
      `,
      [
        userId,
        storeId,
        amount,
        cashbackPercent,
        cashbackAmount.toString(),
      ]
    );

    const purchase = purchaseResult.rows[0];

    // 6. Обновляем баланс wallet
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
        newBalance.toString(),
        wallet.id,
      ]
    );

    const updatedWallet = updatedWalletResult.rows[0];

    // 7. Записываем операцию кешбэка
    const transactionResult = await client.query(
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
        newBalance.toString(),
        `Кешбэк за покупку #${purchase.id}`,
      ]
    );

    const transaction = transactionResult.rows[0];

    await client.query("COMMIT");

    return {
      purchase: {
        id: purchase.id,
        userId: purchase.user_id,
        storeId: purchase.store_id,
        amount: String(purchase.amount),
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

      transaction: {
        id: transaction.id,
        type: transaction.type,
        amount: String(transaction.amount),
        balanceAfter: String(transaction.balance_after),
        description: transaction.description,
        createdAt: transaction.created_at,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}