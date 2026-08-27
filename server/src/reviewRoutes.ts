import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";

const router = Router();

/**
 * GET /reviews?storeId=X
 * Список отзывов магазина. Доступно любому авторизованному клиенту —
 * отзывы других клиентов видны всем, это часть блока "Отзывы" на главном
 * экране (в частности как fallback, когда у магазина нет активной акции).
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const storeId = Number(req.query.storeId);

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return res.status(400).json({
        message: "Некорректный или отсутствующий storeId",
      });
    }

    const result = await pool.query(
      `
      SELECT
        r.id,
        r.rating,
        r.comment,
        r.created_at,
        u.name AS author_name
      FROM reviews r
      INNER JOIN users u ON u.id = r.user_id
      WHERE r.store_id = $1
      ORDER BY r.created_at DESC
      LIMIT 50
      `,
      [storeId]
    );

    res.json({
      reviews: result.rows,
    });
  } catch (error) {
    console.error("Ошибка получения отзывов:", error);

    res.status(500).json({
      message: "Ошибка получения отзывов ❌",
    });
  }
});

/**
 * POST /reviews
 * Клиент оставляет (или обновляет) отзыв о магазине.
 * Можно оставить отзыв только о магазине, к которому клиент подключён.
 * Один клиент — один отзыв на магазин (повторная отправка обновляет
 * существующий, а не создаёт дубликат).
 */
router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { storeId, rating, comment } = req.body;

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return res.status(400).json({
        message: "Некорректный storeId",
      });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        message: "rating должен быть целым числом от 1 до 5",
      });
    }

    const membershipResult = await pool.query(
      `SELECT 1 FROM user_stores WHERE user_id = $1 AND store_id = $2`,
      [userId, storeId]
    );

    if (membershipResult.rows.length === 0) {
      return res.status(400).json({
        message: "Вы не подключены к этому магазину",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO reviews (store_id, user_id, rating, comment)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (store_id, user_id)
      DO UPDATE SET
        rating = EXCLUDED.rating,
        comment = EXCLUDED.comment,
        created_at = NOW()
      RETURNING id, store_id, rating, comment, created_at
      `,
      [storeId, userId, rating, comment || null]
    );

    res.status(201).json({
      message: "Спасибо за отзыв ✅",
      review: result.rows[0],
    });
  } catch (error) {
    console.error("Ошибка сохранения отзыва:", error);

    res.status(500).json({
      message: "Ошибка сохранения отзыва ❌",
    });
  }
});

export default router;
