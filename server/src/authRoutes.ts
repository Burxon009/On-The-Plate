import { Router } from "express";
import { pool } from "./db";
import jwt from "jsonwebtoken";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET не задан в .env");
}

router.post("/login", async (req, res) => {
  try {
    const { phone, name } = req.body;

    if (!phone) {
      return res.status(400).json({
        message: "Телефон обязателен",
      });
    }

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

    res.json({
      message: "Авторизация успешна ✅",
      token,
      user,
    });
  } catch (error) {
    console.error("Ошибка авторизации:", error);

    res.status(500).json({
      message: "Ошибка авторизации ❌",
    });
  }
});

export default router;