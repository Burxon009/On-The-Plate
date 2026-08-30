import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { storeAdminMiddleware } from "./storeAdminMiddleware";
import { createPurchase } from "./purchaseService";
import { logger } from "./logger";

const router = Router();

/**
 * POST /purchases
 * Создать покупку по QR клиента.
 * Опционально: bonusesUsed — сколько бонусов клиент оплачивает
 * (до 100% суммы покупки, ограничение только по реальному балансу).
 * Кешбэк начисляется только с денежной части (amount - bonusesUsed).
 *
 * Доступ только для ADMIN, привязанного именно к этому storeId
 * (проверяется через storeAdminMiddleware) — не к любому магазину.
 */
router.post(
  "/",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { qrToken, storeId, amount, bonusesUsed } = req.body;
      const idempotencyKey = req.header("Idempotency-Key");

      if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
        return res.status(400).json({
          message: "A valid Idempotency-Key header is required",
        });
      }

      if (!qrToken || typeof qrToken !== "string") {
        return res.status(400).json({
          message: "QR-токен обязателен",
        });
      }

      if (!Number.isInteger(storeId) || storeId <= 0) {
        return res.status(400).json({
          message: "Некорректный storeId",
        });
      }

      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return res.status(400).json({
          message: "Некорректная сумма покупки",
        });
      }

      const bonusesUsedAmount =
        bonusesUsed === undefined || bonusesUsed === null ? 0 : bonusesUsed;

      if (!Number.isSafeInteger(bonusesUsedAmount) || bonusesUsedAmount < 0) {
        return res.status(400).json({
          message: "bonusesUsed должен быть целым числом, не меньше 0",
        });
      }

      const userResult = await pool.query(
        `
        SELECT id
        FROM users
        WHERE qr_token = $1
        `,
        [qrToken]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          message: "Клиент по QR не найден",
        });
      }

      const userId = userResult.rows[0].id;

      const result = await createPurchase(
        userId,
        storeId,
        amount,
        bonusesUsedAmount,
        idempotencyKey
      );

      return res.status(201).json({
        message:
          bonusesUsedAmount > 0
            ? "Покупка создана, бонусы списаны, кешбэк начислен ✅"
            : "Покупка создана, кешбэк начислен ✅",
        ...result,
      });
    } catch (error) {
      logger.error({ err: error }, "Ошибка создания покупки");

      const message =
        error instanceof Error
          ? error.message
          : "Ошибка создания покупки";

      // A retry after a successful commit must return the original purchase,
      // not create a second financial operation.
      if ((error as { code?: string }).code === "23505") {
        const idempotencyKey = req.header("Idempotency-Key");
        const existing = await pool.query(
          `SELECT id, user_id, store_id, amount, bonuses_used, cashback_percent, cashback_amount, created_at
           FROM purchases WHERE idempotency_key = $1`,
          [idempotencyKey]
        );

        if (existing.rows.length > 0) {
          return res.status(200).json({
            message: "Purchase already processed",
            purchase: existing.rows[0],
            idempotentReplay: true,
          });
        }
      }

      const knownErrors = [
        "Пользователь не подключён к этому магазину",
        "Магазин не найден или отключён",
        "Кошелёк пользователя не найден",
        "Недостаточно бонусов для оплаты этой суммы",
        "bonusesUsed не может быть больше суммы покупки",
        "bonusesUsed должен быть целым числом, не меньше 0",
      ];

      if (knownErrors.includes(message)) {
        return res.status(400).json({
          message,
        });
      }

      return res.status(500).json({
        message: "Ошибка создания покупки ❌",
      });
    }
  }
);

export default router;
