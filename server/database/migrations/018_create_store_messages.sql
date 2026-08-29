-- Сообщения от магазина конкретному клиенту (например "Хорошего дня 😊").
CREATE TABLE IF NOT EXISTS store_messages (
    id SERIAL PRIMARY KEY,

    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sent_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

    text TEXT NOT NULL,

    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS store_messages_user_id_idx ON store_messages(user_id);
CREATE INDEX IF NOT EXISTS store_messages_store_id_idx ON store_messages(store_id);
