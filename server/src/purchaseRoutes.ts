import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { storeAdminMiddleware } from "./storeAdminMiddleware";
import { createPurchase } from "./purchaseService";

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
        bonusesUsedAmount
      );

      return res.status(201).json({
        message:
          bonusesUsedAmount > 0
            ? "Покупка создана, бонусы списаны, кешбэк начислен ✅"
            : "Покупка создана, кешбэк начислен ✅",
        ...result,
      });
    } catch (error) {
      console.error("Ошибка создания покупки:", error);

      const message =
        error instanceof Error
          ? error.message
          : "Ошибка создания покупки";

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
