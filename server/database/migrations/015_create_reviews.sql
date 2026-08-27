-- Отзывы клиентов о магазине.
-- Показываются в блоке "Отзывы" на главном экране —
-- в частности как fallback, когда у магазина нет активной акции.
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,

    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Один клиент — один отзыв на магазин (можно потом разрешить
    -- редактирование существующего вместо создания нового).
    UNIQUE (store_id, user_id)
);

CREATE INDEX IF NOT EXISTS reviews_store_id_idx ON reviews(store_id);
