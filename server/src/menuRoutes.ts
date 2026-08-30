import { Router } from "express";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { storeAdminMiddleware } from "./storeAdminMiddleware";
import { logger } from "./logger";

const router = Router();

/**
 * GET /menu?storeId=X
 * Клиент видит меню магазина: категории + товары внутри каждой.
 * Товары без категории идут отдельным списком "Без категории".
 * Кешбэк на товар не хранится — фронт сам считает оценку
 * по цене товара и cashback_percent магазина (который приходит
 * отдельно, через GET /stores/my).
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const storeId = Number(req.query.storeId);

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return res.status(400).json({
        message: "Некорректный или отсутствующий storeId",
      });
    }

    const categoriesResult = await pool.query(
      `
      SELECT id, name, sort_order
      FROM menu_categories
      WHERE store_id = $1
      ORDER BY sort_order ASC, id ASC
      `,
      [storeId]
    );

    const productsResult = await pool.query(
      `
      SELECT id, category_id, name, description, price, image_url, sort_order
      FROM menu_products
      WHERE store_id = $1 AND is_available = TRUE
      ORDER BY sort_order ASC, id ASC
      `,
      [storeId]
    );

    res.json({
      categories: categoriesResult.rows,
      products: productsResult.rows,
    });
  } catch (error) {
    logger.error({ err: error }, "Ошибка получения меню");

    res.status(500).json({
      message: "Ошибка получения меню ❌",
    });
  }
});

/**
 * POST /menu/categories
 * Создать категорию меню. Только ADMIN своего магазина.
 * (Пока используется только для наполнения тестовых данных через API —
 * в Angular-клиенте эта функция не вызывается, это задача будущей
 * отдельной админ-панели.)
 */
router.post(
  "/categories",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req, res) => {
    try {
      const { storeId, name, sortOrder } = req.body;

      if (!name || typeof name !== "string") {
        return res.status(400).json({
          message: "Название категории обязательно",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO menu_categories (store_id, name, sort_order)
        VALUES ($1, $2, $3)
        RETURNING id, store_id, name, sort_order, created_at
        `,
        [storeId, name.trim(), Number.isInteger(sortOrder) ? sortOrder : 0]
      );

      res.status(201).json({
        message: "Категория создана ✅",
        category: result.rows[0],
      });
    } catch (error) {
      logger.error({ err: error }, "Ошибка создания категории");

      res.status(500).json({
        message: "Ошибка создания категории ❌",
      });
    }
  }
);

/**
 * POST /menu/products
 * Создать товар. Только ADMIN своего магазина.
 * (Тоже только для API-тестирования, не вызывается из Angular-клиента.)
 */
router.post(
  "/products",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req, res) => {
    try {
      const { storeId, categoryId, name, description, price, imageUrl, sortOrder } = req.body;

      if (!name || typeof name !== "string") {
        return res.status(400).json({
          message: "Название товара обязательно",
        });
      }

      if (!Number.isInteger(price) || price < 0) {
        return res.status(400).json({
          message: "price должен быть целым числом (в сумах), не меньше 0",
        });
      }

      if (categoryId !== undefined && categoryId !== null) {
        const categoryCheck = await pool.query(
          `SELECT 1 FROM menu_categories WHERE id = $1 AND store_id = $2`,
          [categoryId, storeId]
        );

        if (categoryCheck.rows.length === 0) {
          return res.status(400).json({
            message: "Категория не найдена в этом магазине",
          });
        }
      }

      const result = await pool.query(
        `
        INSERT INTO menu_products (
          store_id, category_id, name, description, price, image_url, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          id, store_id, category_id, name, description,
          price, image_url, is_available, sort_order, created_at
        `,
        [
          storeId,
          categoryId || null,
          name.trim(),
          description || null,
          price,
          imageUrl || null,
          Number.isInteger(sortOrder) ? sortOrder : 0,
        ]
      );

      res.status(201).json({
        message: "Товар создан ✅",
        product: result.rows[0],
      });
    } catch (error) {
      logger.error({ err: error }, "Ошибка создания товара");

      res.status(500).json({
        message: "Ошибка создания товара ❌",
      });
    }
  }
);

export default router;
