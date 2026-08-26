import { Router } from "express";
import { pool } from "./db";
import jwt from "jsonwebtoken";
import {
  requestVerificationCode,
  verifyCode,
  isValidPhone,
  VerificationError,
} from "./verificationService";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET не задан в .env");
}

/**
 * POST /auth/request-code
 * Шаг 1: клиент вводит телефон, получает SMS-код.
 *
 * В DEV-режиме (NODE_ENV !== "production") код возвращается
 * прямо в ответе — для тестирования без реального SMS-провайдера.
 * В проде он никогда не возвращается наружу.
 */
router.post("/request-code", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        message: "Некорректный номер телефона. Формат: +998XXXXXXXXX",
      });
    }

    const result = await requestVerificationCode(phone);

    return res.json({
      message: "Код отправлен ✅",
      ...(result.devCode ? { devCode: result.devCode } : {}),
    });
  } catch (error) {
    if (error instanceof VerificationError) {
      return res.status(400).json({ message: error.message });
    }

    console.error("Ошибка запроса кода:", error);

    return res.status(500).json({
      message: "Ошибка запроса кода ❌",
    });
  }
});

/**
 * POST /auth/verify-code
 * Шаг 2: клиент вводит код (+ имя, если это первый вход).
 * После успешной проверки — создаём/логиним пользователя и выдаём JWT.
 */
router.post("/verify-code", async (req, res) => {
  try {
    const { phone, code, name } = req.body;

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        message: "Некорректный номер телефона. Формат: +998XXXXXXXXX",
      });
    }

    if (typeof code !== "string") {
      return res.status(400).json({
        message: "Код обязателен",
      });
    }

    await verifyCode(phone, code);

    let userResult = await pool.query(
      "SELECT id, phone, name, role FROM users WHERE phone = $1",
      [phone]
    );

    let user = userResult.rows[0];

    if (!user) {
      const createResult = await pool.query(
        `INSERT INTO users (phone, name)
         VALUES ($1, $2)
         RETURNING id, phone, name, role`,
        [phone, name || null]
      );

      user = createResult.rows[0];
    } else if (name && !user.name) {
      // Если имя не было сохранено раньше — сохраняем сейчас.
      const updateResult = await pool.query(
        `UPDATE users SET name = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, phone, name, role`,
        [name, user.id]
      );

      user = updateResult.rows[0];
    }

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
      },
      JWT_SECRET,
      {
        expiresIn: "30d",
      }
    );

    return res.json({
      message: "Авторизация успешна ✅",
      token,
      user,
    });
  } catch (error) {
    if (error instanceof VerificationError) {
      return res.status(400).json({ message: error.message });
    }

    console.error("Ошибка авторизации:", error);

    return res.status(500).json({
      message: "Ошибка авторизации ❌",
    });
  }
});

export default router;
