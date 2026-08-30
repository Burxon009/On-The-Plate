import { Pool } from "pg";
import dotenv from "dotenv";
import { logger } from "./logger";

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX ?? 20),
  min: Number(process.env.DB_POOL_MIN ?? 2),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5_000),
  maxLifetimeSeconds: Number(process.env.DB_MAX_LIFETIME_SECONDS ?? 1_800),
  options: [
    `-c statement_timeout=${Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 10_000)}`,
    `-c lock_timeout=${Number(process.env.DB_LOCK_TIMEOUT_MS ?? 5_000)}`,
    `-c idle_in_transaction_session_timeout=${Number(process.env.DB_IDLE_TRANSACTION_TIMEOUT_MS ?? 15_000)}`,
  ].join(" "),
});

pool.on("error", (error) => {
  logger.error({ err: error }, "Unexpected PostgreSQL pool error");
});
