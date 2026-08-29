-- Порядок и видимость блоков главного экрана, которые задаёт ADMIN.
-- block_key — один из фиксированного набора реализованных блоков
-- (проверяется на уровне приложения, не через enum, чтобы легко
-- добавлять новые блоки миграциями без ALTER TYPE).
CREATE TABLE IF NOT EXISTS store_home_blocks (
    id SERIAL PRIMARY KEY,

    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    block_key VARCHAR(50) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE (store_id, block_key)
);

CREATE INDEX IF NOT EXISTS store_home_blocks_store_id_idx
    ON store_home_blocks(store_id);
