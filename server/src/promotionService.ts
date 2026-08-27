import { pool } from "./db";

export interface PromotionProgressResult {
  progress: {
    promotionId: number;
    userId: number;
    currentCount: number;
    cycle: number;
    targetCount: number;
  };

  rewardsIssued: Array<{
    id: number;
    userId: number;
    storeId: number;
    promotionId: number;
    title: string;
    createdAt: Date;
  }>;
}

/**
 * Добавить прогресс клиенту по акции (после сканирования QR админом).
 *
 * Если суммарный прогресс достигает target_count один или несколько раз
 * за один вызов (например добавили сразу +10 при target_count=8),
 * выдаётся соответствующее количество rewards, а остаток (не потерянный)
 * переносится в новый цикл.
 *
 * Пример: currentCount=6, amount=10, targetCount=8
 *   total = 16 → 16 / 8 = 2 reward'а, остаток 0
 */
export async function addPromotionProgress(
  promotionId: number,
  storeId: number,
  qrToken: string,
  amount: number
): Promise<PromotionProgressResult> {
  if (!Number.isInteger(promotionId) || promotionId <= 0) {
    throw new Error("Некорректный ID акции");
  }

  if (!Number.isInteger(storeId) || storeId <= 0) {
    throw new Error("Некорректный storeId");
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Количество единиц должно быть положительным целым числом");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Находим клиента по QR
    const userResult = await client.query(
      `SELECT id FROM users WHERE qr_token = $1`,
      [qrToken]
    );

    if (userResult.rows.length === 0) {
      throw new Error("Клиент по QR не найден");
    }

    const userId = userResult.rows[0].id;

    // 2. Проверяем, что клиент подключён к этому магазину
    const membershipResult = await client.query(
      `SELECT 1 FROM user_stores WHERE user_id = $1 AND store_id = $2`,
      [userId, storeId]
    );

    if (membershipResult.rows.length === 0) {
      throw new Error("Клиент не подключён к этому магазину");
    }

    // 3. Проверяем акцию — принадлежит этому магазину и активна
    const promotionResult = await client.query(
      `
      SELECT id, store_id, target_count, reward_title, is_active
      FROM promotions
      WHERE id = $1 AND store_id = $2
      `,
      [promotionId, storeId]
    );

    if (promotionResult.rows.length === 0) {
      throw new Error("Акция не найдена в этом магазине");
    }

    const promotion = promotionResult.rows[0];

    if (!promotion.is_active) {
      throw new Error("Акция сейчас не активна");
    }

    const targetCount = promotion.target_count as number;

    // 4. Создаём строку прогресса, если её ещё нет
    await client.query(
      `
      INSERT INTO promotion_progress (promotion_id, user_id, current_count, cycle)
      VALUES ($1, $2, 0, 0)
      ON CONFLICT (promotion_id, user_id) DO NOTHING
      `,
      [promotionId, userId]
    );

    // 5. Блокируем строку прогресса на время расчёта
    const progressResult = await client.query(
      `
      SELECT id, current_count, cycle
      FROM promotion_progress
      WHERE promotion_id = $1 AND user_id = $2
      FOR UPDATE
      `,
      [promotionId, userId]
    );

    const progressRow = progressResult.rows[0];
    const total = progressRow.current_count + amount;

    const rewardsToIssue = Math.floor(total / targetCount);
    const remainder = total % targetCount;

    // 6. Обновляем прогресс: остаток переносится, не сгорает
    await client.query(
      `
      UPDATE promotion_progress
      SET current_count = $1,
          cycle = cycle + $2,
          updated_at = NOW()
      WHERE id = $3
      `,
      [remainder, rewardsToIssue, progressRow.id]
    );

    // 7. Выдаём rewards (если условие выполнено один или несколько раз)
    const rewardsIssued: PromotionProgressResult["rewardsIssued"] = [];

    for (let i = 0; i < rewardsToIssue; i++) {
      const rewardResult = await client.query(
        `
        INSERT INTO rewards (user_id, store_id, promotion_id, title)
        VALUES ($1, $2, $3, $4)
        RETURNING id, user_id, store_id, promotion_id, title, created_at
        `,
        [userId, storeId, promotionId, promotion.reward_title]
      );

      const reward = rewardResult.rows[0];

      rewardsIssued.push({
        id: reward.id,
        userId: reward.user_id,
        storeId: reward.store_id,
        promotionId: reward.promotion_id,
        title: reward.title,
        createdAt: reward.created_at,
      });
    }

    await client.query("COMMIT");

    return {
      progress: {
        promotionId,
        userId,
        currentCount: remainder,
        cycle: progressRow.cycle + rewardsToIssue,
        targetCount,
      },
      rewardsIssued,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
