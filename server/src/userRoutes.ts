import { Router, json } from "express";
import rateLimit from "express-rate-limit";
import QRCode from "qrcode";
import { pool } from "./db";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import { adminMiddleware } from "./adminMiddleware";
import { storeAdminMiddleware } from "./storeAdminMiddleware";
import {
  requestVerificationCode,
  verifyCode,
  isValidEmail,
  isValidPhone,
  normalizePhone,
  VerificationError,
} from "./verificationService";
import { logger } from "./logger";

const router = Router();

// Поля профиля, которые клиент имеет право видеть у самого себя.
const SELF_PROFILE_COLUMNS =
  "id, email, name, role, phone, avatar_base64, qr_token, created_at, updated_at";

// Смена email — это смена логин-креденшла, поэтому лимитируем так же
// жёстко, как остальные auth-эндпоинты (те под /auth, эти под /users).
const emailChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT ?? 10),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res
      .status(429)
      .json({ message: "Слишком много попыток. Попробуйте через несколько минут." });
  },
});

// Аватар приходит base64-строкой в теле — глобальный лимит json (100kb)
// для него мал. Даём запас, но проверяем реальный размер в обработчике.
const avatarBodyParser = json({ limit: "400kb" });

// ~200KB после base64-кодирования (по ТЗ).
const MAX_AVATAR_BASE64_LENGTH = 200 * 1024;

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
      `SELECT ${SELF_PROFILE_COLUMNS} FROM users WHERE id = $1`,
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

/**
 * POST /users/manual-code/resolve
 * Найти клиента по короткому числовому коду (storeId + manualCode) —
 * альтернатива QR, когда кассир вводит код вручную без сканера.
 *
 * Права те же, что и у /qr/resolve: admin видит только клиентов своих
 * магазинов. Код уникален В ПРЕДЕЛАХ магазина, поэтому обязательно нужен
 * и storeId, и manualCode.
 */
router.post(
  "/manual-code/resolve",
  authMiddleware,
  adminMiddleware,
  storeAdminMiddleware,
  async (req, res) => {
    try {
      const storeId = Number(req.body?.storeId);
      const manualCode = Number(req.body?.manualCode);

      if (!Number.isInteger(manualCode) || manualCode <= 0) {
        return res.status(400).json({ message: "Некорректный код клиента" });
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
          ON us.user_id = u.id
         AND us.store_id = $1
         AND us.manual_code = $2
        `,
        [storeId, manualCode]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Клиент с таким кодом не найден в этом магазине",
        });
      }

      res.json({
        message: "Клиент найден ✅",
        user: result.rows[0],
      });
    } catch (error) {
      logger.error({ err: error }, "Ошибка поиска клиента по коду");
      res.status(500).json({ message: "Ошибка поиска клиента по коду ❌" });
    }
  }
);

/**
 * PATCH /users/me
 * Обновить имя и/или телефон текущего пользователя.
 * Телефон — просто контактное поле, без SMS/OTP-проверки.
 */
router.patch("/me", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { name, phone } = req.body ?? {};

    const updates: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ message: "Имя не может быть пустым" });
      }
      values.push(name.trim().slice(0, 100));
      updates.push(`name = $${values.length}`);
    }

    if (phone !== undefined) {
      if (phone === null || phone === "") {
        values.push(null);
      } else if (isValidPhone(phone)) {
        // Храним телефон строго в каноническом E.164 — в этом же виде
        // приходит номер при входе по SMS, поэтому вход найдёт этот
        // аккаунт, а не создаст новый.
        const normalized = normalizePhone(phone);
        const taken = await pool.query(
          "SELECT 1 FROM users WHERE phone = $1 AND id <> $2",
          [normalized, userId]
        );
        if (taken.rows.length > 0) {
          return res
            .status(400)
            .json({ message: "Этот номер уже привязан к другому аккаунту" });
        }
        values.push(normalized);
      } else {
        return res.status(400).json({ message: "Некорректный телефон" });
      }
      updates.push(`phone = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "Нечего обновлять" });
    }

    values.push(userId);

    const result = await pool.query(
      `UPDATE users
         SET ${updates.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING ${SELF_PROFILE_COLUMNS}`,
      values
    );

    res.json({ message: "Профиль обновлён ✅", user: result.rows[0] });
  } catch (error) {
    logger.error({ err: error }, "Ошибка обновления профиля");
    res.status(500).json({ message: "Ошибка обновления профиля" });
  }
});

/**
 * POST /users/me/email/request-change { newEmail }
 * Отправляет код подтверждения на НОВЫЙ email. Сам email в БД пока
 * не меняется — только запоминается в users.pending_email.
 */
router.post(
  "/me/email/request-change",
  emailChangeLimiter,
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const rawEmail = req.body?.newEmail;

      if (!isValidEmail(rawEmail)) {
        return res.status(400).json({ message: "Некорректный email" });
      }

      const newEmail = rawEmail.trim().toLowerCase();

      const current = await pool.query(
        "SELECT email FROM users WHERE id = $1",
        [userId]
      );
      if (current.rows[0]?.email === newEmail) {
        return res
          .status(400)
          .json({ message: "Это уже ваш текущий email" });
      }

      const taken = await pool.query(
        "SELECT 1 FROM users WHERE email = $1 AND id <> $2",
        [newEmail, userId]
      );
      if (taken.rows.length > 0) {
        return res
          .status(400)
          .json({ message: "Этот email уже используется" });
      }

      await pool.query(
        "UPDATE users SET pending_email = $1, updated_at = NOW() WHERE id = $2",
        [newEmail, userId]
      );

      await requestVerificationCode(newEmail);

      res.json({ message: "Код отправлен на новый адрес" });
    } catch (error) {
      if (error instanceof VerificationError) {
        return res.status(400).json({ message: error.message });
      }
      logger.error({ err: error }, "Ошибка запроса смены email");
      res.status(500).json({ message: "Не удалось отправить код" });
    }
  }
);

/**
 * POST /users/me/email/confirm-change { code }
 * Проверяет код с нового адреса и, если верный, меняет email в БД.
 */
router.post(
  "/me/email/confirm-change",
  emailChangeLimiter,
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const { code } = req.body ?? {};

      const pending = await pool.query(
        "SELECT pending_email FROM users WHERE id = $1",
        [userId]
      );
      const pendingEmail: string | null = pending.rows[0]?.pending_email ?? null;

      if (!pendingEmail) {
        return res
          .status(400)
          .json({ message: "Смена email не запрашивалась" });
      }

      await verifyCode(pendingEmail, typeof code === "string" ? code : "");

      const updated = await pool.query(
        `UPDATE users
           SET email = $1, pending_email = NULL, updated_at = NOW()
         WHERE id = $2
         RETURNING ${SELF_PROFILE_COLUMNS}`,
        [pendingEmail, userId]
      );

      res.json({ message: "Email изменён ✅", user: updated.rows[0] });
    } catch (error) {
      if (error instanceof VerificationError) {
        return res.status(400).json({ message: error.message });
      }
      logger.error({ err: error }, "Ошибка подтверждения смены email");
      res.status(500).json({ message: "Не удалось подтвердить email" });
    }
  }
);

/**
 * POST /users/me/avatar { image }
 * Принимает base64-строку (обычно data URL) и сохраняет её в БД.
 * Файл на диск НЕ пишется (у Render на free-плане нет постоянного диска).
 */
router.post(
  "/me/avatar",
  avatarBodyParser,
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const image = req.body?.image;

      if (typeof image !== "string" || image.length === 0) {
        return res
          .status(400)
          .json({ message: "Ожидается строка image (base64)" });
      }

      if (!/^data:image\/(png|jpe?g|webp);base64,/.test(image)) {
        return res
          .status(400)
          .json({ message: "Ожидается data URL картинки в base64" });
      }

      if (image.length > MAX_AVATAR_BASE64_LENGTH) {
        return res.status(400).json({
          message:
            "Изображение слишком большое. Максимум ~200 КБ после сжатия.",
        });
      }

      const result = await pool.query(
        `UPDATE users
           SET avatar_base64 = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING avatar_base64`,
        [image, userId]
      );

      res.json({
        message: "Фото обновлено ✅",
        avatar_base64: result.rows[0].avatar_base64,
      });
    } catch (error) {
      logger.error({ err: error }, "Ошибка загрузки аватара");
      res.status(500).json({ message: "Не удалось загрузить фото" });
    }
  }
);

export default router;
