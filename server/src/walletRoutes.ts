import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";

const router = Router();

/**
 * GET /wallet/:storeId/transactions
 * История операций клиента в конкретном магазине
 */
router.get(
  "/:storeId/transactions",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const storeId = Number(req.params.storeId);

      if (!Number.isInteger(storeId) || storeId <= 0) {
        return res.status(400).json({
          message: "Некорректный ID магазина",
        });
      }

      const result = await pool.query(
        `
        SELECT
          wt.id,
          wt.type,
          wt.amount,
          wt.balance_after,
          wt.description,
          wt.created_at
        FROM wallet_transactions wt
        INNER JOIN wallets w
          ON w.id = wt.wallet_id
        WHERE w.user_id = $1
          AND w.store_id = $2
        ORDER BY wt.created_at DESC, wt.id DESC
        `,
        [userId, storeId]
      );

      return res.json({
        transactions: result.rows,
      });
    } catch (error) {
      console.error("Ошибка получения истории:", error);

      return res.status(500).json({
        message: "Ошибка получения истории ❌",
      });
    }
  }
);

/**
 * GET /wallet/:storeId
 * Получить кошелёк клиента в конкретном магазине
 */
router.get(
  "/:storeId",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const storeId = Number(req.params.storeId);

      if (!Number.isInteger(storeId) || storeId <= 0) {
        return res.status(400).json({
          message: "Некорректный ID магазина",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO wallets (
          user_id,
          store_id,
          balance
        )
        SELECT
          us.user_id,
          us.store_id,
          0
        FROM user_stores us
        WHERE us.user_id = $1
          AND us.store_id = $2

        ON CONFLICT (user_id, store_id)
        DO UPDATE SET updated_at = NOW()

        RETURNING
          id,
          user_id,
          store_id,
          balance,
          created_at,
          updated_at
        `,
        [userId, storeId]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          message: "Вы не подключены к этому магазину",
        });
      }

      return res.json({
        wallet: result.rows[0],
      });
    } catch (error) {
      console.error("Ошибка получения кошелька:", error);

      return res.status(500).json({
        message: "Ошибка получения кошелька ❌",
      });
    }
  }
);

export default router;