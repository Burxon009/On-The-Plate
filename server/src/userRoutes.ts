import { Router } from "express";
import QRCode from "qrcode";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { storeAdminMiddleware } from "./storeAdminMiddleware";
import { logger } from "./logger";

const router = Router();

/**
 * GET /users?storeId=123
 * Получить список клиентов КОНКРЕТНОГО магазина.
 *
 * storeId обязателен и проверяется через storeAdminMiddleware —
 * admin видит только клиентов своих магазинов, а не всех клиентов
 * платформы целиком.
 */
router.get(
  "/",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const storeId = Number(req.query.storeId);

      const result = await pool.query(
        `
        SELECT
          u.id,
          u.email,
          u.name,
          u.role,
          u.created_at,
          u.updated_at
        FROM users u
        INNER JOIN user_stores us ON us.user_id = u.id
        WHERE us.store_id = $1
        ORDER BY u.id DESC
        `,
        [storeId]
      );

      res.json(result.rows);
    } catch (error) {
      logger.error({ err: error }, "Ошибка получения пользователей");

      res.status(500).json({
        message: "Ошибка получения пользователей ❌",
      });
    }
  }
);

/**
 * POST /users
 * Создать пользователя вручную (например, для теста).
 * Не привязано к конкретному магазину — пользователь всё равно
 * должен отдельно подключиться к магазину через /stores/:id/join.
 */
router.post(
  "/",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { email, name } = req.body;

      if (!email) {
        return res.status(400).json({
          message: "Email обязателен",
        });
      }

      const result = await pool.query(
        `INSERT INTO users (email, name)
         VALUES ($1, $2)
         RETURNING
          id,
          email,
          name,
          role,
          qr_token,
          created_at,
          updated_at`,
        [email, name || null]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      logger.error({ err: error }, "Ошибка создания пользователя");

      res.status(500).json({
        message: "Ошибка создания пользователя ",
      });
    }
  }
);

/**
 * GET /users/me
 * Получить профиль текущего авторизованного пользователя
 */
router.get("/me", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;

    const result = await pool.query(
      `SELECT
        id,
        email,
        name,
        role,
        qr_token,
        created_at,
        updated_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Пользователь не найден",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error({ err: error }, "Ошибка получения профиля");

    res.status(500).json({
      message: "Ошибка получения профиля ",
    });
  }
});

/**
 * GET /users/me/qr
 * Получить QR-токен текущего пользователя
 */
router.get("/me/qr", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;

    const result = await pool.query(
      `SELECT qr_token
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Пользователь не найден",
      });
    }

    res.json({
      qrToken: result.rows[0].qr_token,
    });
  } catch (error) {
    logger.error({ err: error }, "Ошибка получения QR-токена");

    res.status(500).json({
      message: "Ошибка получения QR-токена ",
    });
  }
});

/**
 * GET /users/me/qr/image
 * Получить настоящий PNG QR-код текущего пользователя
 */
router.get(
  "/me/qr/image",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;

      const result = await pool.query(
        `SELECT qr_token
         FROM users
         WHERE id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Пользователь не найден",
        });
      }

      const qrToken = result.rows[0].qr_token;

      const qrBuffer = await QRCode.toBuffer(String(qrToken), {
        type: "png",
        width: 400,
        margin: 2,
        errorCorrectionLevel: "M",
      });

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");

      res.send(qrBuffer);
    } catch (error) {
      logger.error({ err: error }, "Ошибка генерации QR-кода");

      res.status(500).json({
        message: "Ошибка генерации QR-кода ",
      });
    }
  }
);

/**
 * POST /users/qr/resolve
 * Найти клиента по QR-токену — но только если он подключён
 * именно к тому storeId, который передал admin.
 *
 * Это не даёт admin'у одного магазина "пробивать" по QR клиентов,
 * которые к его магазину вообще не подключены.
 */
router.post(
  "/qr/resolve",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req, res) => {
    try {
      const { qrToken, storeId } = req.body;

      if (!qrToken) {
        return res.status(400).json({
          message: "QR-токен обязателен",
        });
      }

      const result = await pool.query(
        `
        SELECT
          u.id,
          u.email,
          u.name,
          u.role,
          u.created_at,
          u.updated_at
        FROM users u
        INNER JOIN user_stores us
          ON us.user_id = u.id AND us.store_id = $2
        WHERE u.qr_token = $1
        `,
        [qrToken, storeId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message:
            "Клиент не найден или не подключён к этому магазину",
        });
      }

      res.json({
        message: "Клиент найден ✅",
        user: result.rows[0],
      });
    } catch (error) {
      logger.error({ err: error }, "Ошибка поиска клиента по QR");

      res.status(500).json({
        message: "Ошибка поиска клиента по QR ❌",
      });
    }
  }
);

export default router;
