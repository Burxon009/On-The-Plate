import { Response, NextFunction } from "express";
import { AuthRequest } from "./authMiddleware";
import { pool } from "./db";

/**
 * Проверяет, что текущий ADMIN привязан именно к тому магазину,
 * с которым он пытается работать (через таблицу store_admins) —
 * а не просто имеет глобальную роль "admin".
 *
 * storeId ищется в таком порядке:
 * req.params.storeId → req.body.storeId → req.query.storeId
 *
 * Использовать ПОСЛЕ authMiddleware и adminMiddleware —
 * этот middleware полагается на то, что req.user уже заполнен
 * и роль уже проверена как "admin".
 */
export async function storeAdminMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Требуется авторизация",
      });
    }

    const rawStoreId =
      req.params.storeId ?? req.body?.storeId ?? req.query?.storeId;

    const storeId = Number(rawStoreId);

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return res.status(400).json({
        message: "Некорректный или отсутствующий storeId",
      });
    }

    const result = await pool.query(
      `
      SELECT 1
      FROM store_admins
      WHERE user_id = $1 AND store_id = $2
      `,
      [req.user.userId, storeId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        message: "У вас нет доступа к этому магазину",
      });
    }

    next();
  } catch (error) {
    console.error("Ошибка проверки доступа к магазину:", error);

    res.status(500).json({
      message: "Ошибка проверки доступа к магазину ❌",
    });
  }
}
