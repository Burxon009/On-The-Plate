import { Request, Response, Router } from "express";
import { pool } from "./db";
import {
  requestVerificationCode,
  verifyCode,
  isValidEmail,
  VerificationError,
} from "./verificationService";
import {
  createAccessToken,
  createRefreshSession,
  revokeRefreshSession,
  rotateRefreshSession,
} from "./sessionService";
import { logger } from "./logger";

const router = Router();
const refreshCookieName = "ucafe_refresh";
const isProduction = process.env.NODE_ENV === "production";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function requestContext(req: Request) {
  return { ip: req.ip, userAgent: req.header("user-agent") };
}

function getCookie(req: Request, name: string): string | undefined {
  const prefix = `${name}=`;
  return req.headers.cookie
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
}

function getRefreshToken(req: Request): string | undefined {
  const bodyToken = req.body?.refreshToken;
  return typeof bodyToken === "string" ? bodyToken : getCookie(req, refreshCookieName);
}

function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(refreshCookieName, refreshToken, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : isProduction,
    sameSite: "strict",
    path: "/",
    maxAge: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(refreshCookieName, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : isProduction,
    sameSite: "strict",
    path: "/",
  });
}

function sendSession(res: Response, req: Request, user: { id: number; role: string; email?: string; name?: string | null }, refreshToken: string) {
  setRefreshCookie(res, refreshToken);
  const response: Record<string, unknown> = {
    message: "Авторизация успешна",
    // `token` remains for existing clients; it is now a 15-minute access token.
    token: createAccessToken(user),
    user,
  };
  // Native clients must store this only in OS secure storage. Web clients use the HttpOnly cookie.
  if (req.header("x-client-type") === "mobile") response.refreshToken = refreshToken;
  return res.json(response);
}

router.post("/request-code", async (req, res) => {
  try {
    const { email } = req.body;
    if (!isValidEmail(email)) return res.status(400).json({ message: "Некорректный email" });
    await requestVerificationCode(email);
    // Same response for valid requests prevents account enumeration.
    return res.json({ message: "Если адрес доступен, код будет отправлен" });
  } catch (error) {
    if (error instanceof VerificationError) return res.status(400).json({ message: error.message });
    logger.error({ err: error }, "OTP request failed");
    return res.status(500).json({ message: "Не удалось запросить код" });
  }
});

router.post("/verify-code", async (req, res) => {
  try {
    const { email, code, name } = req.body;
    if (!isValidEmail(email) || typeof code !== "string") {
      return res.status(400).json({ message: "Некорректные данные подтверждения" });
    }
    await verifyCode(email, code);
    const normalizedEmail = normalizeEmail(email);
    let userResult = await pool.query("SELECT id, email, name, role FROM users WHERE email = $1", [normalizedEmail]);
    let user = userResult.rows[0];
    if (!user) {
      const created = await pool.query(
        "INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email, name, role",
        [normalizedEmail, typeof name === "string" ? name.trim().slice(0, 100) || null : null]
      );
      user = created.rows[0];
    } else if (typeof name === "string" && name.trim() && !user.name) {
      const updated = await pool.query(
        "UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, role",
        [name.trim().slice(0, 100), user.id]
      );
      user = updated.rows[0];
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const refreshToken = await createRefreshSession(client, user.id, requestContext(req));
      await client.query("COMMIT");
      return sendSession(res, req, user, refreshToken);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof VerificationError) return res.status(400).json({ message: error.message });
    logger.error({ err: error }, "OTP verification failed");
    return res.status(500).json({ message: "Не удалось завершить авторизацию" });
  }
});

router.post("/refresh", async (req, res) => {
  const refreshToken = getRefreshToken(req);
  if (!refreshToken) return res.status(401).json({ message: "Refresh session is required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rotated = await rotateRefreshSession(client, refreshToken, requestContext(req));
    if (!rotated) {
      await client.query("COMMIT");
      clearRefreshCookie(res);
      return res.status(401).json({ message: "Refresh session is invalid" });
    }
    await client.query("COMMIT");
    const userResult = await pool.query(
      "SELECT id, email, name, role FROM users WHERE id = $1",
      [rotated.user.id]
    );
    return sendSession(res, req, userResult.rows[0], rotated.refreshToken);
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Token refresh failed");
    return res.status(500).json({ message: "Unable to refresh session" });
  } finally {
    client.release();
  }
});

router.post("/logout", async (req, res) => {
  const refreshToken = getRefreshToken(req);
  if (refreshToken) {
    const client = await pool.connect();
    try {
      await revokeRefreshSession(client, refreshToken);
    } finally {
      client.release();
    }
  }
  clearRefreshCookie(res);
  return res.status(204).end();
});

export default router;
