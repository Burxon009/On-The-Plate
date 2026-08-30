import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { storeAdminMiddleware } from "./storeAdminMiddleware";

const router = Router();

/**
 * GET /stores
 * Получить список активных магазинов
 * Доступно авторизованным клиентам
 */
router.get("/", authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        name,
        description,
        logo_url,
        primary_color,
        is_active,
        created_at,
        updated_at
      FROM stores
      WHERE is_active = TRUE
      ORDER BY id DESC
      `
    );

    res.json({
      stores: result.rows,
    });
  } catch (error) {
    console.error("Ошибка получения магазинов:", error);

    res.status(500).json({
      message: "Ошибка получения магазинов ❌",
    });
  }
});

/**
 * POST /stores
 * Создать магазин.
 * Только ADMIN.
 *
 * Создатель автоматически привязывается к новому магазину
 * через store_admins — становится его единственным admin,
 * пока сам не добавит других (отдельным запросом в будущем).
 */
router.post(
  "/",
  authMiddleware,
  adminMiddleware,
  async (req: AuthRequest, res) => {
    const client = await pool.connect();

    try {
      const { name, description, logoUrl, primaryColor } = req.body;

      if (!name || typeof name !== "string") {
        return res.status(400).json({
          message: "Название магазина обязательно",
        });
      }

      await client.query("BEGIN");

      const storeResult = await client.query(
        `
        INSERT INTO stores (
          name,
          description,
          logo_url,
          primary_color
        )
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          name,
          description,
          logo_url,
          primary_color,
          is_active,
          created_at,
          updated_at
        `,
        [
          name.trim(),
          description || null,
          logoUrl || null,
          primaryColor || null,
        ]
      );

      const store = storeResult.rows[0];

      // Привязываем создателя как admin этого магазина.
      await client.query(
        `
        INSERT INTO store_admins (user_id, store_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, store_id) DO NOTHING
        `,
        [req.user!.userId, store.id]
      );

      await client.query("COMMIT");

      res.status(201).json({
        message: "Магазин создан ✅",
        store,
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("Ошибка создания магазина:", error);

      res.status(500).json({
        message: "Ошибка создания магазина ❌",
      });
    } finally {
      client.release();
    }
  }
);

/**
 * POST /stores/:storeId/join
 * Добавить магазин клиенту
 */
router.post(
  "/:storeId/join",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const storeId = Number(req.params.storeId);

      if (!Number.isInteger(storeId)) {
        return res.status(400).json({
          message: "Некорректный ID магазина",
        });
      }

      // Проверяем, существует ли магазин
      const storeResult = await pool.query(
        `
        SELECT id, name, is_active
        FROM stores
        WHERE id = $1
        `,
        [storeId]
      );

      if (storeResult.rows.length === 0) {
        return res.status(404).json({
          message: "Магазин не найден",
        });
      }

      if (!storeResult.rows[0].is_active) {
        return res.status(400).json({
          message: "Магазин отключён",
        });
      }

      // Добавляем магазин клиенту
      const result = await pool.query(
        `
        INSERT INTO user_stores (user_id, store_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, store_id)
        DO NOTHING
        RETURNING id, user_id, store_id, created_at
        `,
        [userId, storeId]
      );

      if (result.rows.length === 0) {
        return res.status(409).json({
          message: "Этот магазин уже добавлен",
        });
      }

      res.status(201).json({
        message: "Магазин добавлен ✅",
        userStore: result.rows[0],
      });
    } catch (error) {
      console.error("Ошибка добавления магазина:", error);

      res.status(500).json({
        message: "Ошибка добавления магазина ❌",
      });
    }
  }
);

/**
 * GET /stores/my
 * Получить магазины текущего клиента
 */
router.get(
  "/my",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;

      const result = await pool.query(
        `
        SELECT
          s.id,
          s.name,
          s.description,
          s.logo_url,
          s.primary_color,
          s.cashback_percent,
          s.is_active,
          us.created_at AS added_at
        FROM user_stores us
        INNER JOIN stores s ON s.id = us.store_id
        WHERE us.user_id = $1
          AND s.is_active = TRUE
        ORDER BY us.created_at DESC
        `,
        [userId]
      );

      res.json({
        stores: result.rows,
      });
    } catch (error) {
      console.error("Ошибка получения магазинов клиента:", error);

      res.status(500).json({
        message: "Ошибка получения магазинов ❌",
      });
    }
  }
);

/**
 * GET /stores/managed
 * Получить список магазинов, которыми управляет текущий admin.
 * Нужно для админ-панели — чтобы admin видел только свои магазины,
 * а не все существующие.
 */
router.get(
  "/managed",
  authMiddleware,
  adminMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          s.id,
          s.name,
          s.description,
          s.logo_url,
          s.primary_color,
          s.is_active,
          sa.created_at AS linked_at
        FROM store_admins sa
        INNER JOIN stores s ON s.id = sa.store_id
        WHERE sa.user_id = $1
        ORDER BY sa.created_at DESC
        `,
        [req.user!.userId]
      );

      res.json({
        stores: result.rows,
      });
    } catch (error) {
      console.error("Ошибка получения магазинов admin:", error);

      res.status(500).json({
        message: "Ошибка получения магазинов ❌",
      });
    }
  }
);

export default router;
