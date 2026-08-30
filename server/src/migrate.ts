import fs from "fs";
import path from "path";
import { pool } from "./db";
import { logger } from "./logger";

async function migrate() {
  const migrationsDir = path.join(
    __dirname,
    "../database/migrations"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  const migrations = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const migration of migrations) {
    const alreadyExecuted = await pool.query(
      "SELECT id FROM migrations WHERE filename = $1",
      [migration]
    );

    if (alreadyExecuted.rows.length > 0) {
      logger.info(`⏭️ Пропускаем ${migration} — уже выполнена`);
      continue;
    }

    const filePath = path.join(migrationsDir, migration);
    const sql = fs.readFileSync(filePath, "utf-8");

    logger.info(`▶ Выполняем ${migration}...`);

    await pool.query("BEGIN");

    try {
      await pool.query(sql);

      await pool.query(
        "INSERT INTO migrations (filename) VALUES ($1)",
        [migration]
      );

      await pool.query("COMMIT");

      logger.info(`✅ ${migration} выполнена`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  await pool.end();

  logger.info("✅ Все миграции выполнены");
}

migrate().catch((error) => {
  logger.error({ err: error }, "❌ Ошибка миграции");
  process.exit(1);
});