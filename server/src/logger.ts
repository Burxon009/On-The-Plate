import { mkdirSync } from "fs";
import path from "path";
import pino from "pino";
import pretty from "pino-pretty";

/**
 * Единый логгер на весь backend.
 *
 * - dev (NODE_ENV !== "production"): читаемый цветной вывод в консоль (pino-pretty)
 *   ПЛЮС запись в файлы.
 * - prod: только файлы (консоль отдаётся демону/оркестратору).
 * - test: тихий логгер — не шумит в выводе тестов и не плодит файлы.
 *
 * Файлы: logs/app-YYYY-MM-DD.log (info и выше) и logs/error-YYYY-MM-DD.log
 * (только error и выше). Новый файл на каждый день запуска — простая
 * ежедневная ротация без внешних зависимостей.
 *
 * Все потоки СИНХРОННЫЕ (pino.multistream, без worker-транспорта): строка
 * гарантированно записана к моменту возврата из logger.*(), в т.ч. в
 * короткоживущих CLI-скриптах (backup/migrate) и в обработчиках
 * uncaughtException прямо перед process.exit().
 */

const nodeEnv = process.env.NODE_ENV;
const isProduction = nodeEnv === "production";
const isTest = nodeEnv === "test";

function buildLogger(): pino.Logger {
  if (isTest) {
    return pino({ level: "silent" });
  }

  const logDir = path.resolve(__dirname, "..", "logs");
  mkdirSync(logDir, { recursive: true });

  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const streams: pino.StreamEntry[] = [
    {
      level: "info",
      stream: pino.destination({
        dest: path.join(logDir, `app-${day}.log`),
        sync: true,
        mkdir: true,
      }),
    },
    {
      level: "error",
      stream: pino.destination({
        dest: path.join(logDir, `error-${day}.log`),
        sync: true,
        mkdir: true,
      }),
    },
  ];

  if (!isProduction) {
    streams.push({
      level: "info",
      stream: pretty({
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
        ignore: "pid,hostname",
        sync: true,
        destination: 1, // stdout
      }),
    });
  }

  return pino(
    { level: process.env.LOG_LEVEL ?? "info" },
    pino.multistream(streams)
  );
}

export const logger = buildLogger();
