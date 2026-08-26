CREATE TABLE IF NOT EXISTS user_stores (
    id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    store_id INTEGER NOT NULL
        REFERENCES stores(id)
        ON DELETE CASCADE,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, store_id)
);