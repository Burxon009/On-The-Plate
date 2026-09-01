-- Быстрая разблокировка приложения: PIN-код (4 цифры) + биометрия
-- (Face ID / отпечаток через WebAuthn).
--
-- Это НЕ второй способ входа. Основной вход остаётся email/SMS + код и
-- 30-дневная refresh-сессия. PIN/биометрия — это "замок" поверх уже
-- активной сессии: при повторных открытиях приложения интерфейс
-- заблокирован, пока человек не разблокирует его PIN'ом или биометрией.
--
-- Все операции идемпотентны (IF NOT EXISTS) — миграцию можно прогнать
-- на уже существующей БД.

-- ── PIN ────────────────────────────────────────────────────────────────
-- pin_hash: HMAC-SHA256(pepper, "pin:<userId>:<pin>") — в открытом виде
--   PIN не хранится, как и коды подтверждения (verification_codes).
-- pin_failed_attempts: счётчик ПОДРЯД идущих неверных попыток. Сбрасывается
--   при успешной разблокировке.
-- pin_locked_until: после 5 неверных подряд PIN блокируется на время, а
--   все refresh-сессии пользователя отзываются — нужен полный вход заново.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMP;

-- ── Биометрия: WebAuthn credentials ───────────────────────────────────
-- Одно устройство пользователя = одна строка. credential_id и public_key
-- хранятся в base64url. counter — счётчик подписей authenticator'а,
-- растёт при каждом использовании (защита от клонирования ключа).
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id            SERIAL PRIMARY KEY,

    user_id       INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    credential_id TEXT NOT NULL UNIQUE,     -- base64url
    public_key    TEXT NOT NULL,            -- base64url (COSE-ключ)
    counter       BIGINT NOT NULL DEFAULT 0,
    transports    TEXT[],                   -- ['internal','hybrid',...] — подсказка браузеру

    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMP
);

CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx
    ON webauthn_credentials(user_id);

-- ── Одноразовый WebAuthn challenge между *-options и *-verify ──────────
-- @simplewebauthn выдаёт challenge в ответе *-options, а при *-verify его
-- нужно предъявить обратно. Держим по одному висящему challenge на юзера
-- (TTL 5 минут); повторный запрос options его перезаписывает.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
    user_id    INTEGER PRIMARY KEY
        REFERENCES users(id)
        ON DELETE CASCADE,

    challenge  TEXT NOT NULL,
    purpose    TEXT NOT NULL
        CHECK (purpose IN ('register', 'authenticate')),
    expires_at TIMESTAMP NOT NULL
);
