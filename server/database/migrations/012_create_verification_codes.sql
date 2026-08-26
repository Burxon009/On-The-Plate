CREATE TABLE IF NOT EXISTS verification_codes (
    id SERIAL PRIMARY KEY,

    phone VARCHAR(20) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,

    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,

    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS verification_codes_phone_idx
    ON verification_codes(phone);

CREATE INDEX IF NOT EXISTS verification_codes_expires_at_idx
    ON verification_codes(expires_at);
