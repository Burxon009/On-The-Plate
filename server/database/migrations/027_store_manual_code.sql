-- Короткий числовой код клиента для РУЧНОГО ввода кассиром (без сканера QR).
--
-- Код ОТДЕЛЬНЫЙ на каждый магазин, не глобальный на человека: кошелёк и так
-- живёт на паре клиент+магазин, поэтому и код нумеруется внутри магазина —
-- 000001, 000002, ... (с ведущими нулями уже на клиенте).
--
-- Операции идемпотентны (IF NOT EXISTS) — миграцию можно прогнать повторно.

-- Счётчик следующего свободного кода отдельно на каждый магазин.
CREATE TABLE IF NOT EXISTS store_manual_code_counters (
    store_id  INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    next_code INTEGER NOT NULL DEFAULT 1
);

-- Сам код — в связи клиент↔магазин. NULL у связей, созданных до этой миграции
-- (бэкофилл — отдельно, по решению владельца проекта).
ALTER TABLE user_stores ADD COLUMN IF NOT EXISTS manual_code INTEGER;

-- Уникальность кода — в пределах ОДНОГО магазина (частичный индекс: NULL'ы
-- друг другу не мешают).
CREATE UNIQUE INDEX IF NOT EXISTS user_stores_store_manual_code_idx
    ON user_stores (store_id, manual_code)
    WHERE manual_code IS NOT NULL;
