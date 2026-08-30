import { mkdirSync } from "fs";
import path from "path";
import pino from "pino";

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

  const targets: pino.TransportTargetOptions[] = [
    {
      target: "pino/file",
      level: "info",
      options: { destination: path.join(logDir, `app-${day}.log`), mkdir: true },
    },
    {
      target: "pino/file",
      level: "error",
      options: { destination: path.join(logDir, `error-${day}.log`), mkdir: true },
    },
  ];

  if (!isProduction) {
    targets.push({
      target: "pino-pretty",
      level: "info",
      options: {
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    });
  }

  return pino(
    { level: process.env.LOG_LEVEL ?? "info" },
    pino.transport({ targets })
  );
}

export const logger = buildLogger();
