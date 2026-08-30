import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import userRoutes from "./userRoutes";
import authRoutes from "./authRoutes";
import walletRoutes from "./walletRoutes";
import storeRoutes from "./storeRoutes";
import purchaseRoutes from "./purchaseRoutes";
import promotionRoutes from "./promotionRoutes";
import rewardRoutes from "./rewardRoutes";
import reviewRoutes from "./reviewRoutes";
import menuRoutes from "./menuRoutes";
import homeBlockRoutes from "./homeBlockRoutes";
import messageRoutes from "./messageRoutes";
import { pool } from "./db";
import { cleanupVerificationCodes } from "./verificationService";
import { logger } from "./logger";

// Логируем и завершаем процесс при неизвестной ошибке — не пытаемся
// "продолжить работу" в неопределённом состоянии, но и не падаем молча.
process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "uncaughtException — процесс завершается");
  // Небольшая задержка, чтобы транспорт логгера успел дописать файл.
  setTimeout(() => process.exit(1), 200).unref();
});
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err }, "unhandledRejection — процесс завершается");
  setTimeout(() => process.exit(1), 200).unref();
});

const app = express();
if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}
const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:4200")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(helmet());

// Логирование каждого HTTP-запроса — идёт сразу после helmet, ДО rate-limit
// и CORS, чтобы в лог попадали и запросы, отсечённые 429/403.
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const payload = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    };
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${payload.durationMs}ms`;
    if (res.statusCode >= 500) logger.error(payload, line);
    else if (res.statusCode >= 400) logger.warn(payload, line);
    else logger.info(payload, line);
  });
  next();
});

app.use(express.json({ limit: "100kb" }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT ?? 300),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ message: "Слишком много запросов. Попробуйте позже." });
  },
}));
app.use("/auth", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT ?? 10),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ message: "Слишком много попыток входа. Попробуйте через несколько минут." });
  },
}));
app.use((req, res, next) => {
  const origin = req.header("Origin");
  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ message: "Origin is not allowed" });
  }
  if (origin) res.header("Access-Control-Allow-Origin", origin);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health/live", (_req, res) => res.status(200).json({ status: "ok" }));
app.get("/health/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

app.use("/users", userRoutes);
app.use("/auth", authRoutes);
app.use("/wallet", walletRoutes);
app.use("/stores", storeRoutes);
app.use("/purchases", purchaseRoutes);
app.use("/promotions", promotionRoutes);
app.use("/rewards", rewardRoutes);
app.use("/reviews", reviewRoutes);
app.use("/menu", menuRoutes);
app.use("/home-blocks", homeBlockRoutes);
app.use("/messages", messageRoutes);

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => logger.info(`API listening on port ${port}`));

void cleanupVerificationCodes().catch((error) =>
  logger.error({ err: error }, "OTP cleanup failed")
);
const otpCleanupTimer = setInterval(() => {
  void cleanupVerificationCodes().catch((error) =>
    logger.error({ err: error }, "OTP cleanup failed")
  );
}, 60 * 60 * 1000);
otpCleanupTimer.unref();

function shutdown(signal: string) {
  logger.info(`${signal} received; shutting down`);
  server.close(() => void pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
