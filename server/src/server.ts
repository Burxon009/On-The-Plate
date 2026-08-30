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
const server = app.listen(port, () => console.log(`API listening on port ${port}`));

void cleanupVerificationCodes().catch((error) =>
  console.error("OTP cleanup failed:", error instanceof Error ? error.message : error)
);
const otpCleanupTimer = setInterval(() => {
  void cleanupVerificationCodes().catch((error) =>
    console.error("OTP cleanup failed:", error instanceof Error ? error.message : error)
  );
}, 60 * 60 * 1000);
otpCleanupTimer.unref();

function shutdown(signal: string) {
  console.log(`${signal} received; shutting down`);
  server.close(() => void pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
