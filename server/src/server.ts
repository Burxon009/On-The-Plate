import express from "express";
import userRoutes from "./userRoutes";
import authRoutes from "./authRoutes";
import walletRoutes from "./walletRoutes";
import storeRoutes from "./storeRoutes";
import purchaseRoutes from "./purchaseRoutes";
import promotionRoutes from "./promotionRoutes";
import rewardRoutes from "./rewardRoutes";
import reviewRoutes from "./reviewRoutes";
import menuRoutes from "./menuRoutes";
import { pool } from "./db";

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:4200');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
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

const PORT = 3000;

app.get("/", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      message: "U CAFE Loyalty API работает! ☕",
      database: "PostgreSQL подключён ✅",
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error("Ошибка PostgreSQL:", error);

    res.status(500).json({
      message: "Ошибка подключения к PostgreSQL ❌",
    });
  }
});

app.listen(PORT, () => {
  console.log(`U CAFE Loyalty API запущен: http://localhost:${PORT}`);
});
