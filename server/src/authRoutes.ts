import { Router } from "express";
import { pool } from "./db";
import jwt from "jsonwebtoken";
import {
  requestVerificationCode,
  verifyCode,
  isValidEmail,
  VerificationError,
} from "./verificationService";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET не задан в .env");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * POST /auth/request-code
 * Шаг 1: клиент вводит email, получает код подтверждения.
 *
 * В DEV-режиме (NODE_ENV !== "production") код возвращается
 * прямо в ответе — для тестирования без реального email-провайдера.
 * В проде он никогда не возвращается наружу.
 */
router.post("/request-code", async (req, res) => {
  try {
    const { email } = req.body;

    if (!isValidEmail(email)) {
      return res.status(400).json({
        message: "Некорректный email",
      });
    }

    const result = await requestVerificationCode(email);

    return res.json({
      message: "Код отправлен на почту ✅",
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
    const { email, code, name } = req.body;

    if (!isValidEmail(email)) {
      return res.status(400).json({
        message: "Некорректный email",
      });
    }

    if (typeof code !== "string") {
      return res.status(400).json({
        message: "Код обязателен",
      });
    }

    await verifyCode(email, code);

    const normalizedEmail = normalizeEmail(email);

    let userResult = await pool.query(
      "SELECT id, email, name, role FROM users WHERE email = $1",
      [normalizedEmail]
    );

    let user = userResult.rows[0];

    if (!user) {
      const createResult = await pool.query(
        `INSERT INTO users (email, name)
         VALUES ($1, $2)
         RETURNING id, email, name, role`,
        [normalizedEmail, name || null]
      );

      user = createResult.rows[0];
    } else if (name && !user.name) {
      const updateResult = await pool.query(
        `UPDATE users SET name = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, email, name, role`,
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
