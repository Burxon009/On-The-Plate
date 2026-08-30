import { mkdirSync } from "fs";
import path from "path";
import pino from "pino";
import pretty from "pino-pretty";

/**
 * Два логгера, оба пишут в одни и те же файлы:
 *   logs/app-YYYY-MM-DD.log   (info и выше)
 *   logs/error-YYYY-MM-DD.log (только error и выше)
 * Новый файл на каждый день запуска — простая ежедневная ротация.
 *
 * 1. logger — АСИНХРОННЫЙ (pino.transport, worker-поток). Для
 *    request-логирования и повседневных info/warn/error: не блокирует
 *    обработку запроса. Нагрузочный тест показал, что синхронная запись
 *    на каждый HTTP-запрос режет пропускную способность почти вдвое.
 *
 * 2. crashLogger — СИНХРОННЫЙ (pino.destination sync). ТОЛЬКО для
 *    обработчиков uncaughtException / unhandledRejection в server.ts:
 *    там процесс всё равно умирает, и стектрейс обязан попасть на диск
 *    ДО process.exit(). Цена в миллисекундах роли не играет.
 *
 * В режиме тестов оба — тихие (не шумят в выводе, не плодят файлы).
 */

const nodeEnv = process.env.NODE_ENV;
const isProduction = nodeEnv === "production";
const isTest = nodeEnv === "test";

function logFilePaths() {
  const logDir = path.resolve(__dirname, "..", "logs");
  mkdirSync(logDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return {
    app: path.join(logDir, `app-${day}.log`),
    error: path.join(logDir, `error-${day}.log`),
  };
}

const prettyOptions = {
  colorize: true,
  translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
  ignore: "pid,hostname",
};

function buildLogger(): pino.Logger {
  if (isTest) return pino({ level: "silent" });

  const p = logFilePaths();
  const targets: pino.TransportTargetOptions[] = [
    { target: "pino/file", level: "info", options: { destination: p.app, mkdir: true } },
    { target: "pino/file", level: "error", options: { destination: p.error, mkdir: true } },
  ];
  if (!isProduction) {
    targets.push({ target: "pino-pretty", level: "info", options: prettyOptions });
  }

  return pino(
    { level: process.env.LOG_LEVEL ?? "info" },
    pino.transport({ targets })
  );
}

function buildCrashLogger(): pino.Logger {
  if (isTest) return pino({ level: "silent" });

  const p = logFilePaths();
  const streams: pino.StreamEntry[] = [
    { level: "error", stream: pino.destination({ dest: p.app, sync: true, mkdir: true }) },
    { level: "error", stream: pino.destination({ dest: p.error, sync: true, mkdir: true }) },
  ];
  if (!isProduction) {
    // pino-pretty как синхронный поток — чтобы краш было видно и в консоли.
    streams.push({ level: "error", stream: pretty({ ...prettyOptions, sync: true, destination: 1 }) });
  }

  return pino({ level: "error" }, pino.multistream(streams));
}

export const logger = buildLogger();
export const crashLogger = buildCrashLogger();
