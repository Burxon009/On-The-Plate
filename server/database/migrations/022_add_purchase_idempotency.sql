-- Идемпотентность создания покупок: клиент присылает заголовок
-- Idempotency-Key, повторный запрос с тем же ключом не должен создавать
-- вторую покупку (purchaseService/purchaseRoutes полагаются на эту колонку
-- и уникальный частичный индекс).
--
-- Колонка и индекс уже были применены к рабочей БД в обход системы
-- миграций — этот файл фиксирует их как обычную миграцию, чтобы на чистой
-- базе структура собиралась целиком. Все операции идемпотентны
-- (IF NOT EXISTS), файл безопасно прогнать повторно.
ALTER TABLE purchases
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS purchases_idempotency_key_idx
    ON purchases(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
