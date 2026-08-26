CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    store_id INTEGER NOT NULL
        REFERENCES stores(id)
        ON DELETE CASCADE,

    amount BIGINT NOT NULL
        CHECK (amount > 0),

    cashback_percent NUMERIC(5,2) NOT NULL
        CHECK (cashback_percent >= 0 AND cashback_percent <= 100),

    cashback_amount BIGINT NOT NULL
        CHECK (cashback_amount >= 0),

    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchases_user_store_idx
    ON purchases(user_id, store_id);

CREATE INDEX IF NOT EXISTS purchases_created_at_idx
    ON purchases(created_at);