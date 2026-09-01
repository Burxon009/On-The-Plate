import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware, AuthRequest } from "./authMiddleware";
import {
  setPin,
  verifyPin,
  changePin,
  hasPin,
  PinError,
  PinLockedError,
} from "./pinService";
import {
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
  hasCredentials,
  listCredentials,
  deleteAllCredentials,
  WebAuthnError,
} from "./webauthnService";
import { logger } from "./logger";

/**
 * Быстрая разблокировка приложения: PIN + биометрия (WebAuthn).
 * Всё под authMiddleware — человек уже вошёл через email/SMS, мы лишь
 * "открываем замок" на активной сессии, а не логиним заново.
 *
 * Маршруты смонтированы на /auth, но в обход строгого лимитера входа
 * (см. server.ts): разблокировка происходит при каждом открытии
 * приложения и не должна упираться в лимит попыток логина.
 */
const router = Router();

// Проверка PIN/биометрии — свой лимитер поверх глобального API-лимита.
// Основная защита от перебора PIN — счётчик 5 попыток подряд в pinService.
const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.UNLOCK_RATE_LIMIT ?? 30),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res
      .status(429)
      .json({ message: "Слишком много попыток. Попробуйте через несколько минут." });
  },
});

function handlePinError(res: import("express").Response, error: unknown): boolean {
  if (error instanceof PinLockedError) {
    res.status(423).json({ message: error.message, code: "pin_locked" });
    return true;
  }
  if (error instanceof PinError) {
    res.status(400).json({ message: error.message });
    return true;
  }
  return false;
}

/**
 * GET /auth/lock/status
 * Состояние "замка" для текущего пользователя — фронт решает, какие
 * экраны показывать (установка PIN / экран блокировки / включение биометрии).
 */
router.get("/lock/status", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [pinSet, webauthn] = await Promise.all([
      hasPin(userId),
      hasCredentials(userId),
    ]);
    res.json({ pinSet, webauthn });
  } catch (error) {
    logger.error({ err: error }, "lock status failed");
    res.status(500).json({ message: "Не удалось получить состояние блокировки" });
  }
});

/**
 * POST /auth/pin/set { pin }
 * Установить PIN (первичная установка или перезапись).
 */
router.post("/pin/set", authMiddleware, async (req: AuthRequest, res) => {
  try {
    await setPin(req.user!.userId, req.body?.pin);
    res.json({ message: "PIN установлен" });
  } catch (error) {
    if (handlePinError(res, error)) return;
    logger.error({ err: error }, "pin set failed");
    res.status(500).json({ message: "Не удалось установить PIN" });
  }
});

/**
 * POST /auth/pin/change { currentPin, newPin }
 * Сменить PIN — сверяет текущий, ставит новый.
 */
router.post("/pin/change", unlockLimiter, authMiddleware, async (req: AuthRequest, res) => {
  try {
    await changePin(req.user!.userId, req.body?.currentPin, req.body?.newPin);
    res.json({ message: "PIN изменён" });
  } catch (error) {
    if (handlePinError(res, error)) return;
    logger.error({ err: error }, "pin change failed");
    res.status(500).json({ message: "Не удалось изменить PIN" });
  }
});

/**
 * POST /auth/pin/verify { pin }
 * Разблокировать интерфейс по PIN. Сессия уже валидна — полного входа нет.
 */
router.post("/pin/verify", unlockLimiter, authMiddleware, async (req: AuthRequest, res) => {
  try {
    await verifyPin(req.user!.userId, req.body?.pin);
    res.json({ message: "Разблокировано" });
  } catch (error) {
    if (handlePinError(res, error)) return;
    logger.error({ err: error }, "pin verify failed");
    res.status(500).json({ message: "Не удалось проверить PIN" });
  }
});

/* ── Биометрия (WebAuthn) ──────────────────────────────────────────── */

function handleWebAuthnError(res: import("express").Response, error: unknown): boolean {
  if (error instanceof WebAuthnError) {
    res.status(400).json({ message: error.message });
    return true;
  }
  return false;
}

/** Challenge для регистрации нового устройства (Face ID / отпечаток). */
router.post("/webauthn/register-options", authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json(await getRegistrationOptions(req.user!.userId));
  } catch (error) {
    if (handleWebAuthnError(res, error)) return;
    logger.error({ err: error }, "webauthn register-options failed");
    res.status(500).json({ message: "Не удалось начать привязку биометрии" });
  }
});

/** Проверка ответа браузера, сохранение credential. */
router.post("/webauthn/register-verify", authMiddleware, async (req: AuthRequest, res) => {
  try {
    await verifyRegistration(req.user!.userId, req.body?.response);
    res.json({ message: "Биометрия подключена" });
  } catch (error) {
    if (handleWebAuthnError(res, error)) return;
    logger.error({ err: error }, "webauthn register-verify failed");
    res.status(500).json({ message: "Не удалось подключить биометрию" });
  }
});

/** Challenge для разблокировки биометрией. */
router.post("/webauthn/auth-options", authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json(await getAuthenticationOptions(req.user!.userId));
  } catch (error) {
    if (handleWebAuthnError(res, error)) return;
    logger.error({ err: error }, "webauthn auth-options failed");
    res.status(500).json({ message: "Не удалось начать разблокировку" });
  }
});

/** Проверка подписи — при успехе интерфейс разблокирован. */
router.post("/webauthn/auth-verify", unlockLimiter, authMiddleware, async (req: AuthRequest, res) => {
  try {
    await verifyAuthentication(req.user!.userId, req.body?.response);
    res.json({ message: "Разблокировано" });
  } catch (error) {
    if (handleWebAuthnError(res, error)) return;
    logger.error({ err: error }, "webauthn auth-verify failed");
    res.status(500).json({ message: "Не удалось проверить биометрию" });
  }
});

/** Список привязанных устройств (профиль). */
router.get("/webauthn/credentials", authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json({ credentials: await listCredentials(req.user!.userId) });
  } catch (error) {
    logger.error({ err: error }, "webauthn credentials list failed");
    res.status(500).json({ message: "Не удалось получить список устройств" });
  }
});

/** Отключить биометрию — удалить все credentials пользователя. */
router.delete("/webauthn/credentials", authMiddleware, async (req: AuthRequest, res) => {
  try {
    await deleteAllCredentials(req.user!.userId);
    res.json({ message: "Биометрия отключена" });
  } catch (error) {
    logger.error({ err: error }, "webauthn credentials delete failed");
    res.status(500).json({ message: "Не удалось отключить биометрию" });
  }
});

export default router;
