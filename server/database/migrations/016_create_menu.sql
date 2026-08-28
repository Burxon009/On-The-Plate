-- Категории меню магазина (например: Кофе, Выпечка, Сладкое).
CREATE TABLE IF NOT EXISTS menu_categories (
    id SERIAL PRIMARY KEY,

    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS menu_categories_store_id_idx ON menu_categories(store_id);

-- Товары. Кешбэк отдельно на товар НЕ хранится — используется общий
-- cashback_percent магазина (клиент считает оценочную сумму сам,
-- по цене товара и проценту магазина).
CREATE TABLE IF NOT EXISTS menu_products (
    id SERIAL PRIMARY KEY,

    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES menu_categories(id) ON DELETE SET NULL,

    name VARCHAR(255) NOT NULL,
    description TEXT,
    price INTEGER NOT NULL CHECK (price >= 0),
    image_url TEXT,

    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS menu_products_store_id_idx ON menu_products(store_id);
CREATE INDEX IF NOT EXISTS menu_products_category_id_idx ON menu_products(category_id);
