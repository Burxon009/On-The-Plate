import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Все тесты работают с одной реальной тестовой БД, поэтому файлы
    // выполняются последовательно — параллельные транзакции гонялись бы
    // за одни и те же таблицы.
    fileParallelism: false,

    // Создаёт/мигрирует ucafe_loyalty_test перед прогоном и дропает после.
    globalSetup: ["./test/globalSetup.ts"],

    // Подменяем имя БД ДО того, как src/db.ts выполнит dotenv.config()
    // (dotenv не перезаписывает уже установленные переменные).
    env: {
      DB_NAME: "ucafe_loyalty_test",
      NODE_ENV: "test",
    },

    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
