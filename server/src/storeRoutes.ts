import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { storeAdminMiddleware } from "./storeAdminMiddleware";
import { assignManualCode } from "./manualCodeService";
import { logger } from "./logger";

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
    logger.error({ err: error }, "Ошибка получения магазинов");

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

      logger.error({ err: error }, "Ошибка создания магазина");

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
    const userId = req.user!.userId;
    const storeId = Number(req.params.storeId);

    if (!Number.isInteger(storeId)) {
      return res.status(400).json({
        message: "Некорректный ID магазина",
      });
    }

    const client = await pool.connect();
    try {
      const storeResult = await client.query(
        `SELECT id, name, is_active FROM stores WHERE id = $1`,
        [storeId]
      );

      if (storeResult.rows.length === 0) {
        return res.status(404).json({ message: "Магазин не найден" });
      }
      if (!storeResult.rows[0].is_active) {
        return res.status(400).json({ message: "Магазин отключён" });
      }

      await client.query("BEGIN");

      // Создаём связь клиент↔магазин.
      const linkResult = await client.query(
        `
        INSERT INTO user_stores (user_id, store_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, store_id) DO NOTHING
        RETURNING id
        `,
        [userId, storeId]
      );

      if (linkResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Этот магазин уже добавлен" });
      }

      // Присваиваем короткий числовой код клиента — отдельная нумерация
      // на каждый магазин, атомарно в этой же транзакции.
      await assignManualCode(client, storeId, linkResult.rows[0].id);

      const updated = await client.query(
        `
        SELECT id, user_id, store_id, manual_code, created_at
          FROM user_stores
         WHERE id = $1
        `,
        [linkResult.rows[0].id]
      );

      await client.query("COMMIT");

      res.status(201).json({
        message: "Магазин добавлен ✅",
        userStore: updated.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      logger.error({ err: error }, "Ошибка добавления магазина");
      res.status(500).json({ message: "Ошибка добавления магазина ❌" });
    } finally {
      client.release();
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
          us.manual_code,
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
      logger.error({ err: error }, "Ошибка получения магазинов клиента");

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
      logger.error({ err: error }, "Ошибка получения магазинов admin");

      res.status(500).json({
        message: "Ошибка получения магазинов ❌",
      });
    }
  }
);

export default router;
