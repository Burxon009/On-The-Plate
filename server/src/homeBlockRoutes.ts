import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { storeAdminMiddleware } from "./storeAdminMiddleware";
import { logger } from "./logger";

const router = Router();

// Фиксированный набор блоков, для которых реально реализован показ данных.
// "Новинки" и "Сообщения" сюда пока не входят — там ещё нет своей
// сущности/данных, добавим при реализации этих блоков.
const KNOWN_BLOCK_KEYS = ["promotions", "rewards", "menu", "messages", "history"] as const;
type BlockKey = (typeof KNOWN_BLOCK_KEYS)[number];

const DEFAULT_ORDER: BlockKey[] = ["promotions", "menu", "rewards", "messages", "history"];

/**
 * GET /home-blocks?storeId=X
 * Порядок и видимость блоков для конкретного магазина.
 *
 * Если admin ещё ничего не настраивал — возвращается порядок по
 * умолчанию (все блоки включены), чтобы главный экран работал
 * "из коробки" без обязательной настройки.
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
      SELECT block_key, sort_order, is_enabled
      FROM store_home_blocks
      WHERE store_id = $1
      ORDER BY sort_order ASC
      `,
      [storeId]
    );

    if (result.rows.length === 0) {
      // Ничего не настроено — отдаём дефолтный порядок, не создавая
      // записей в БД (создаются только когда admin реально сохранит).
      return res.json({
        blocks: DEFAULT_ORDER.map((blockKey, index) => ({
          block_key: blockKey,
          sort_order: index,
          is_enabled: true,
        })),
      });
    }

    res.json({
      blocks: result.rows,
    });
  } catch (error) {
    logger.error({ err: error }, "Ошибка получения блоков главного экрана");

    res.status(500).json({
      message: "Ошибка получения блоков главного экрана ❌",
    });
  }
});

/**
 * POST /home-blocks
 * Admin своего магазина задаёт порядок и видимость блоков целиком.
 * body: { storeId, blocks: [{ blockKey, sortOrder, isEnabled }, ...] }
 */
router.post(
  "/",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { storeId, blocks } = req.body;

      if (!Array.isArray(blocks) || blocks.length === 0) {
        return res.status(400).json({
          message: "blocks должен быть непустым массивом",
        });
      }

      for (const block of blocks) {
        if (!KNOWN_BLOCK_KEYS.includes(block.blockKey)) {
          return res.status(400).json({
            message: `Неизвестный blockKey: ${block.blockKey}. Разрешены: ${KNOWN_BLOCK_KEYS.join(", ")}`,
          });
        }

        if (!Number.isInteger(block.sortOrder)) {
          return res.status(400).json({
            message: "sortOrder обязателен и должен быть целым числом",
          });
        }
      }

      await client.query("BEGIN");

      for (const block of blocks) {
        await client.query(
          `
          INSERT INTO store_home_blocks (store_id, block_key, sort_order, is_enabled)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (store_id, block_key)
          DO UPDATE SET
            sort_order = EXCLUDED.sort_order,
            is_enabled = EXCLUDED.is_enabled,
            updated_at = NOW()
          `,
          [storeId, block.blockKey, block.sortOrder, block.isEnabled !== false]
        );
      }

      await client.query("COMMIT");

      const result = await client.query(
        `
        SELECT block_key, sort_order, is_enabled
        FROM store_home_blocks
        WHERE store_id = $1
        ORDER BY sort_order ASC
        `,
        [storeId]
      );

      res.json({
        message: "Порядок блоков сохранён ✅",
        blocks: result.rows,
      });
    } catch (error) {
      await client.query("ROLLBACK");

      logger.error({ err: error }, "Ошибка сохранения блоков главного экрана");

      res.status(500).json({
        message: "Ошибка сохранения блоков главного экрана ❌",
      });
    } finally {
      client.release();
    }
  }
);

export default router;
