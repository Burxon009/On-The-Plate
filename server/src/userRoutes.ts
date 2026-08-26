import { Router } from "express";
import QRCode from "qrcode";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";

const router = Router();

/**
 * GET /users
 * Получить список всех пользователей
 */
router.get(
  "/",
  authMiddleware,
  adminMiddleware,
  async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        id,
        phone,
        name,
        role,
        qr_token,
        created_at,
        updated_at
       FROM users
       ORDER BY id DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка получения пользователей:", error);

    res.status(500).json({
      message: "Ошибка получения пользователей ❌",
    });
  }
});

/**
 * POST /users
 * Создать пользователя
 */
router.post(
  "/",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
  try {
    const { phone, name } = req.body;

    if (!phone) {
      return res.status(400).json({
        message: "Телефон обязателен",
      });
    }

    const result = await pool.query(
      `INSERT INTO users (phone, name)
       VALUES ($1, $2)
       RETURNING
        id,
        phone,
        name,
        role,
        qr_token,
        created_at,
        updated_at`,
      [phone, name || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка создания пользователя:", error);

    res.status(500).json({
      message: "Ошибка создания пользователя ",
    });
  }
});

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
        phone,
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
    console.error("Ошибка получения профиля:", error);

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
    console.error("Ошибка получения QR-токена:", error);

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
      console.error("Ошибка генерации QR-кода:", error);

      res.status(500).json({
        message: "Ошибка генерации QR-кода ",
      });
    }
  }
);
/**
 * POST /users/qr/resolve
 * Найти клиента по QR-токену
 */
router.post(
  "/qr/resolve",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
  try {
    const { qrToken } = req.body;

    if (!qrToken) {
      return res.status(400).json({
        message: "QR-токен обязателен",
      });
    }

    const result = await pool.query(
      `SELECT
        id,
        phone,
        name,
        role,
        created_at,
        updated_at
       FROM users
       WHERE qr_token = $1`,
      [qrToken]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Клиент по QR не найден",
      });
    }

    res.json({
      message: "Клиент найден ✅",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Ошибка поиска клиента по QR:", error);

    res.status(500).json({
      message: "Ошибка поиска клиента по QR ❌",
    });
  }
});

export default router;