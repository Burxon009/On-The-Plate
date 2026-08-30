import "dotenv/config";
import { Client } from "pg";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const TEST_DB = "ucafe_loyalty_test";

const adminConn = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

async function dropTestDb() {
  const admin = new Client({ ...adminConn, database: "postgres" });
  await admin.connect();
  // WITH (FORCE) вышибает оставшиеся коннекты (пул из src/db.ts).
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.end();
}

export async function setup() {
  await dropTestDb();

  const admin = new Client({ ...adminConn, database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  // Прогоняем те же самые файлы миграций, что и продовая БД —
  // проверяем логику на реальной схеме, а не на выдуманной.
  const db = new Client({ ...adminConn, database: TEST_DB });
  await db.connect();
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  const dir = join(__dirname, "..", "database", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf-8");
    await db.query(sql);
    await db.query("INSERT INTO migrations (filename) VALUES ($1)", [file]);
  }
  await db.end();
}

export async function teardown() {
  await dropTestDb();
}
