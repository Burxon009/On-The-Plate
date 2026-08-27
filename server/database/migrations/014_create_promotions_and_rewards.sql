-- Акции магазина.
-- target_count — сколько единиц нужно набрать для получения reward
-- (например 8 в "7 покупок → 8-я в подарок": на 8-й единице выдаётся reward).
CREATE TABLE IF NOT EXISTS promotions (
    id SERIAL PRIMARY KEY,

    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    title VARCHAR(255) NOT NULL,
    description TEXT,

    target_count INTEGER NOT NULL CHECK (target_count > 0),
    reward_title VARCHAR(255) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    starts_at TIMESTAMP,
    ends_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS promotions_store_id_idx ON promotions(store_id);
CREATE INDEX IF NOT EXISTS promotions_is_active_idx ON promotions(is_active);

-- Текущий прогресс конкретного клиента по конкретной акции.
-- current_count — прогресс в ТЕКУЩЕМ цикле (после выдачи reward обнуляется
-- до остатка, а не до нуля — остаток от деления переносится).
-- cycle — счётчик, сколько раз уже выполнено условие акции этим клиентом
-- (не обязателен для логики, но полезен для статистики/истории).
CREATE TABLE IF NOT EXISTS promotion_progress (
    id SERIAL PRIMARY KEY,

    promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    current_count INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),
    cycle INTEGER NOT NULL DEFAULT 0 CHECK (cycle >= 0),

    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE (promotion_id, user_id)
);

CREATE INDEX IF NOT EXISTS promotion_progress_user_id_idx
    ON promotion_progress(user_id);

-- Выданные rewards. Отдельная сущность от wallet — получение НЕ меняет баланс.
CREATE TABLE IF NOT EXISTS rewards (
    id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    promotion_id INTEGER REFERENCES promotions(id) ON DELETE SET NULL,

    title VARCHAR(255) NOT NULL,

    is_redeemed BOOLEAN NOT NULL DEFAULT FALSE,
    redeemed_at TIMESTAMP,
    redeemed_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rewards_user_id_idx ON rewards(user_id);
CREATE INDEX IF NOT EXISTS rewards_store_id_idx ON rewards(store_id);
CREATE INDEX IF NOT EXISTS rewards_is_redeemed_idx ON rewards(is_redeemed);
