import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { storeAdminMiddleware } from "./storeAdminMiddleware";
import { addPromotionProgress } from "./promotionService";

const router = Router();

/**
 * GET /promotions?storeId=X
 * Клиент видит активные акции магазина + свой прогресс по каждой.
 */
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const storeId = Number(req.query.storeId);

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return res.status(400).json({
        message: "Некорректный или отсутствующий storeId",
      });
    }

    const userId = req.user!.userId;

    const result = await pool.query(
      `
      SELECT
        p.id,
        p.title,
        p.description,
        p.target_count,
        p.reward_title,
        p.starts_at,
        p.ends_at,
        COALESCE(pp.current_count, 0) AS current_count,
        COALESCE(pp.cycle, 0) AS cycle
      FROM promotions p
      LEFT JOIN promotion_progress pp
        ON pp.promotion_id = p.id AND pp.user_id = $2
      WHERE p.store_id = $1
        AND p.is_active = TRUE
        AND (p.starts_at IS NULL OR p.starts_at <= NOW())
        AND (p.ends_at IS NULL OR p.ends_at >= NOW())
      ORDER BY p.id DESC
      `,
      [storeId, userId]
    );

    res.json({
      promotions: result.rows,
    });
  } catch (error) {
    console.error("Ошибка получения акций:", error);

    res.status(500).json({
      message: "Ошибка получения акций ❌",
    });
  }
});

/**
 * POST /promotions
 * Создать акцию. Только ADMIN, привязанный к этому storeId.
 */
router.post(
  "/",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req, res) => {
    try {
      const {
        storeId,
        title,
        description,
        targetCount,
        rewardTitle,
        startsAt,
        endsAt,
      } = req.body;

      if (!title || typeof title !== "string") {
        return res.status(400).json({
          message: "Название акции обязательно",
        });
      }

      if (!Number.isInteger(targetCount) || targetCount <= 0) {
        return res.status(400).json({
          message: "targetCount должен быть положительным целым числом",
        });
      }

      if (!rewardTitle || typeof rewardTitle !== "string") {
        return res.status(400).json({
          message: "Название награды (rewardTitle) обязательно",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO promotions (
          store_id,
          title,
          description,
          target_count,
          reward_title,
          starts_at,
          ends_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          id, store_id, title, description,
          target_count, reward_title, is_active,
          starts_at, ends_at, created_at
        `,
        [
          storeId,
          title.trim(),
          description || null,
          targetCount,
          rewardTitle.trim(),
          startsAt || null,
          endsAt || null,
        ]
      );

      res.status(201).json({
        message: "Акция создана ✅",
        promotion: result.rows[0],
      });
    } catch (error) {
      console.error("Ошибка создания акции:", error);

      res.status(500).json({
        message: "Ошибка создания акции ❌",
      });
    }
  }
);

/**
 * PATCH /promotions/:id/toggle
 * Включить/выключить акцию. Только ADMIN своего магазина.
 * storeId передаётся в теле — по нему проверяется доступ
 * И одновременно фильтруется UPDATE, чтобы нельзя было
 * переключить чужую акцию, зная только её id.
 */
router.patch(
  "/:id/toggle",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req, res) => {
    try {
      const promotionId = Number(req.params.id);
      const { storeId, isActive } = req.body;

      if (!Number.isInteger(promotionId)) {
        return res.status(400).json({
          message: "Некорректный ID акции",
        });
      }

      if (typeof isActive !== "boolean") {
        return res.status(400).json({
          message: "isActive должен быть true или false",
        });
      }

      const result = await pool.query(
        `
        UPDATE promotions
        SET is_active = $1, updated_at = NOW()
        WHERE id = $2 AND store_id = $3
        RETURNING id, store_id, title, is_active
        `,
        [isActive, promotionId, storeId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Акция не найдена в этом магазине",
        });
      }

      res.json({
        message: "Статус акции обновлён ✅",
        promotion: result.rows[0],
      });
    } catch (error) {
      console.error("Ошибка обновления акции:", error);

      res.status(500).json({
        message: "Ошибка обновления акции ❌",
      });
    }
  }
);

/**
 * POST /promotions/:id/progress
 * Admin вручную добавляет прогресс клиенту после сканирования QR.
 * storeId в теле — проверяется через storeAdminMiddleware.
 */
router.post(
  "/:id/progress",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req, res) => {
    try {
      const promotionId = Number(req.params.id);
      const { storeId, qrToken, amount } = req.body;

      if (!Number.isInteger(promotionId)) {
        return res.status(400).json({
          message: "Некорректный ID акции",
        });
      }

      if (!qrToken || typeof qrToken !== "string") {
        return res.status(400).json({
          message: "QR-токен обязателен",
        });
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({
          message: "amount должен быть положительным целым числом",
        });
      }

      const result = await addPromotionProgress(
        promotionId,
        storeId,
        qrToken,
        amount
      );

      res.json({
        message:
          result.rewardsIssued.length > 0
            ? `Прогресс обновлён, выдано наград: ${result.rewardsIssued.length} 🎉`
            : "Прогресс обновлён ✅",
        ...result,
      });
    } catch (error) {
      console.error("Ошибка обновления прогресса акции:", error);

      const message =
        error instanceof Error ? error.message : "Ошибка обновления прогресса";

      const knownErrors = [
        "Клиент по QR не найден",
        "Клиент не подключён к этому магазину",
        "Акция не найдена в этом магазине",
        "Акция сейчас не активна",
      ];

      if (knownErrors.includes(message)) {
        return res.status(400).json({ message });
      }

      res.status(500).json({
        message: "Ошибка обновления прогресса акции ❌",
      });
    }
  }
);

export default router;
