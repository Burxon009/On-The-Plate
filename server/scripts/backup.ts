import "dotenv/config";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import path from "path";
import { logger } from "../src/logger";

/**
 * Локальное резервное копирование PostgreSQL через pg_dump.
 *
 * Пока нет отдельного сервера — дампы складываются в server/backups/ на этой
 * же машине. Файлы старше RETENTION_DAYS удаляются после каждого прогона.
 *
 * pg_dump ищется так: $PG_BIN_DIR → C:\Program Files\PostgreSQL\*\bin →
 * pg_dump в PATH.
 */

const RETENTION_DAYS = 30;
const backupsDir = path.resolve(__dirname, "..", "backups");

function resolvePgDump(): string {
  const exe = process.platform === "win32" ? "pg_dump.exe" : "pg_dump";

  const fromEnv = process.env.PG_BIN_DIR && path.join(process.env.PG_BIN_DIR, exe);
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  // Стандартная установка PostgreSQL на Windows — берём самую свежую версию.
  const pgRoot = "C:\\Program Files\\PostgreSQL";
  if (existsSync(pgRoot)) {
    const versions = readdirSync(pgRoot)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => b - a);
    for (const v of versions) {
      const candidate = path.join(pgRoot, String(v), "bin", exe);
      if (existsSync(candidate)) return candidate;
    }
  }

  return exe; // последняя надежда — вдруг есть в PATH
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(
    d.getMinutes()
  )}-${p(d.getSeconds())}`;
}

function pruneOldBackups(): number {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const file of readdirSync(backupsDir)) {
    if (!/^backup-.*\.sql$/.test(file)) continue;
    const full = path.join(backupsDir, file);
    if (statSync(full).mtimeMs < cutoff) {
      unlinkSync(full);
      removed += 1;
      logger.info({ file }, "Удалён устаревший бэкап");
    }
  }
  return removed;
}

function main(): void {
  const dbName = process.env.DB_NAME;
  const dbHost = process.env.DB_HOST ?? "localhost";
  const dbPort = process.env.DB_PORT ?? "5432";
  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;

  if (!dbName || !dbUser || !dbPassword) {
    logger.error("Резервное копирование прервано: не заданы DB_NAME / DB_USER / DB_PASSWORD в .env");
    process.exit(1);
  }

  mkdirSync(backupsDir, { recursive: true });

  const pgDump = resolvePgDump();
  const outPath = path.join(backupsDir, `backup-${timestamp()}.sql`);

  logger.info({ db: dbName, host: dbHost, port: dbPort, pgDump, outPath }, "Запуск pg_dump");

  const result = spawnSync(
    pgDump,
    [
      "-h", dbHost,
      "-p", dbPort,
      "-U", dbUser,
      "-d", dbName,
      "--no-owner",
      "--no-privileges",
      "-f", outPath,
    ],
    {
      env: { ...process.env, PGPASSWORD: dbPassword },
      encoding: "utf-8",
    }
  );

  if (result.error) {
    logger.error({ err: result.error, pgDump }, "Не удалось запустить pg_dump");
    process.exit(1);
  }

  if (result.status !== 0) {
    logger.error(
      { status: result.status, stderr: (result.stderr || "").trim() },
      "pg_dump завершился с ошибкой"
    );
    // Частично записанный файл лучше убрать.
    if (existsSync(outPath)) unlinkSync(outPath);
    process.exit(1);
  }

  const sizeBytes = statSync(outPath).size;
  const sizeKb = Math.round((sizeBytes / 1024) * 100) / 100;

  const removed = pruneOldBackups();

  // Структурированная запись — в logs/app-*.log (машиночитаемый аудит-след).
  logger.info(
    { outPath, sizeBytes, sizeKb, prunedOld: removed, retentionDays: RETENTION_DAYS },
    `Бэкап создан: ${path.basename(outPath)} (${sizeKb} KB)`
  );

  // Человекочитаемое подтверждение для интерактивного запуска. Прямой
  // синхронный stdout.write, а не pino-pretty: после spawnSync поток
  // pino-pretty не успевает сброситься в консоль до выхода процесса,
  // тогда как process.stdout.write() гарантированно доходит.
  process.stdout.write(
    `✅ Бэкап БД создан: ${outPath}\n` +
      `   размер: ${sizeKb} KB${removed > 0 ? `, удалено старых: ${removed}` : ""}\n`
  );

  process.exit(0);
}

main();
