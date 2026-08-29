import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { storeAdminMiddleware } from "./storeAdminMiddleware";

const router = Router();

/**
 * GET /messages?storeId=X
 * Клиент видит свои сообщения от этого магазина, новые сверху.
 */
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const storeId = Number(req.query.storeId);

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return res.status(400).json({
        message: "Некорректный или отсутствующий storeId",
      });
    }

    const result = await pool.query(
      `
      SELECT id, text, is_read, read_at, created_at
      FROM store_messages
      WHERE store_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      `,
      [storeId, req.user!.userId]
    );

    res.json({
      messages: result.rows,
    });
  } catch (error) {
    console.error("Ошибка получения сообщений:", error);

    res.status(500).json({
      message: "Ошибка получения сообщений ❌",
    });
  }
});

/**
 * POST /messages/:id/read
 * Клиент отмечает своё сообщение прочитанным.
 */
router.post("/:id/read", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const messageId = Number(req.params.id);

    if (!Number.isInteger(messageId)) {
      return res.status(400).json({
        message: "Некорректный ID сообщения",
      });
    }

    const result = await pool.query(
      `
      UPDATE store_messages
      SET is_read = TRUE, read_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING id, text, is_read, read_at, created_at
      `,
      [messageId, req.user!.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Сообщение не найдено",
      });
    }

    res.json({
      message: "Сообщение отмечено прочитанным ✅",
      storeMessage: result.rows[0],
    });
  } catch (error) {
    console.error("Ошибка обновления сообщения:", error);

    res.status(500).json({
      message: "Ошибка обновления сообщения ❌",
    });
  }
});

/**
 * POST /messages
 * Admin отправляет сообщение конкретному клиенту своего магазина.
 * (Только для API-тестирования — в Angular-клиенте не вызывается,
 * это задача будущей отдельной админ-панели.)
 */
router.post(
  "/",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { storeId, userId, text } = req.body;

      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({
          message: "Текст сообщения обязателен",
        });
      }

      const membershipResult = await pool.query(
        `SELECT 1 FROM user_stores WHERE user_id = $1 AND store_id = $2`,
        [userId, storeId]
      );

      if (membershipResult.rows.length === 0) {
        return res.status(400).json({
          message: "Клиент не подключён к этому магазину",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO store_messages (store_id, user_id, sent_by_admin_id, text)
        VALUES ($1, $2, $3, $4)
        RETURNING id, store_id, user_id, text, is_read, created_at
        `,
        [storeId, userId, req.user!.userId, text.trim()]
      );

      res.status(201).json({
        message: "Сообщение отправлено ✅",
        storeMessage: result.rows[0],
      });
    } catch (error) {
      console.error("Ошибка отправки сообщения:", error);

      res.status(500).json({
        message: "Ошибка отправки сообщения ❌",
      });
    }
  }
);

export default router;
