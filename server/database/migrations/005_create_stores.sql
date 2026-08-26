CREATE TABLE IF NOT EXISTS stores (
    id SERIAL PRIMARY KEY,

    name VARCHAR(150) NOT NULL,
    description TEXT,

    logo_url TEXT,
    primary_color VARCHAR(20),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);