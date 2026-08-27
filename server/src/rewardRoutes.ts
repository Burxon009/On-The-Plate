import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { storeAdminMiddleware } from "./storeAdminMiddleware";

const router = Router();

/**
 * GET /rewards?storeId=X
 * Клиент видит свои rewards. storeId опционален — без него
 * возвращаются rewards по всем магазинам клиента сразу.
 * (rewards — отдельная сущность от wallet, не влияет на баланс.)
 */
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const storeIdRaw = req.query.storeId;

    const params: (number | string)[] = [userId];
    let storeFilter = "";

    if (storeIdRaw !== undefined) {
      const storeId = Number(storeIdRaw);

      if (!Number.isInteger(storeId) || storeId <= 0) {
        return res.status(400).json({
          message: "Некорректный storeId",
        });
      }

      params.push(storeId);
      storeFilter = "AND r.store_id = $2";
    }

    const result = await pool.query(
      `
      SELECT
        r.id,
        r.store_id,
        r.promotion_id,
        r.title,
        r.is_redeemed,
        r.redeemed_at,
        r.created_at,
        s.name AS store_name
      FROM rewards r
      INNER JOIN stores s ON s.id = r.store_id
      WHERE r.user_id = $1
      ${storeFilter}
      ORDER BY r.created_at DESC
      `,
      params
    );

    res.json({
      rewards: result.rows,
    });
  } catch (error) {
    console.error("Ошибка получения rewards:", error);

    res.status(500).json({
      message: "Ошибка получения rewards ❌",
    });
  }
});

/**
 * POST /rewards/:id/redeem
 * Admin отмечает reward использованным (клиент получил бесплатный товар).
 * storeId в теле — проверяется через storeAdminMiddleware, и им же
 * фильтруется UPDATE, чтобы нельзя было погасить чужой reward,
 * зная только его id.
 */
router.post(
  "/:id/redeem",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const rewardId = Number(req.params.id);
      const { storeId } = req.body;

      if (!Number.isInteger(rewardId)) {
        return res.status(400).json({
          message: "Некорректный ID reward",
        });
      }

      const result = await pool.query(
        `
        UPDATE rewards
        SET is_redeemed = TRUE,
            redeemed_at = NOW(),
            redeemed_by_admin_id = $1
        WHERE id = $2
          AND store_id = $3
          AND is_redeemed = FALSE
        RETURNING id, user_id, store_id, title, is_redeemed, redeemed_at
        `,
        [req.user!.userId, rewardId, storeId]
      );

      if (result.rows.length === 0) {
        return res.status(409).json({
          message:
            "Reward не найден, не в этом магазине, или уже использован",
        });
      }

      res.json({
        message: "Reward отмечен использованным ✅",
        reward: result.rows[0],
      });
    } catch (error) {
      console.error("Ошибка погашения reward:", error);

      res.status(500).json({
        message: "Ошибка погашения reward ❌",
      });
    }
  }
);

export default router;
