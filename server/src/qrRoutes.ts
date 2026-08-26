import { Router } from "express";
import crypto from "crypto";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";

const router = Router();

/**
 * GET /qr
 * Получить персональный QR-токен клиента
 */
router.get(
  "/",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;

      // Генерируем новый токен только на случай,
      // если у пользователя его ещё нет.
      const newToken = crypto.randomBytes(32).toString("hex");

      const result = await pool.query(
        `
        UPDATE users
        SET qr_token = COALESCE(qr_token, $1)
        WHERE id = $2
        RETURNING id, qr_token
        `,
        [newToken, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Пользователь не найден",
        });
      }

      res.json({
        qrToken: result.rows[0].qr_token,
      });
    } catch (error) {
      console.error("Ошибка получения QR:", error);

      res.status(500).json({
        message: "Ошибка получения QR ❌",
      });
    }
  }
);

export default router;