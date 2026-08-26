import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { createPurchase } from "./purchaseService";

const router = Router();

/**
 * POST /purchases
 * Создать покупку по QR клиента.
 *
 * Доступ только для ADMIN.
 */
router.post(
  "/",
  authMiddleware,
  adminMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { qrToken, storeId, amount } = req.body;

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
        amount
      );

      return res.status(201).json({
        message: "Покупка создана, кешбэк начислен ✅",
        ...result,
      });
    } catch (error) {
      console.error("Ошибка создания покупки:", error);

      const message =
        error instanceof Error
          ? error.message
          : "Ошибка создания покупки";

      if (
        message ===
          "Пользователь не подключён к этому магазину" ||
        message === "Магазин не найден или отключён" ||
        message === "Кошелёк пользователя не найден"
      ) {
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